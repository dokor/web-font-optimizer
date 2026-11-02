import { posix } from 'node:path';
import ts from 'typescript';
import type { Analyzer, Location, Observation, SourceFile } from '../../contracts.js';
import { fontProperties, fontValue } from './values.js';

const scriptKinds = { js: ts.ScriptKind.JSX, jsx: ts.ScriptKind.JSX, ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX };

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

/** A single in-memory source: no config, module resolution, lib reads or writes. */
function checkerFor(tree: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: file => file === tree.fileName ? tree : undefined,
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: file => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: file => file === tree.fileName,
    readFile: () => undefined,
  };
  return ts.createProgram([tree.fileName], {
    noLib: true, noResolve: true, types: [], allowJs: true, jsx: ts.JsxEmit.Preserve,
  }, host).getTypeChecker();
}

function analyze(source: SourceFile): Observation[] {
  if (!(source.language in scriptKinds)) return [];
  const tree = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true,
    scriptKinds[source.language as keyof typeof scriptKinds]);
  const checker = checkerFor(tree);
  const observations: Observation[] = [];
  const modules = new Map<ts.Symbol, string>();
  const reactNamespaces = new Set<ts.Symbol>();
  const createElements = new Set<ts.Symbol>();
  const symbol = (node: ts.Node) => ts.isShorthandPropertyAssignment(node.parent) && node === node.parent.name
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
  const location = (node: ts.Node): Location => {
    const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    return { file: source.file, line: line + 1, column: character + 1 };
  };
  function unknown(node: ts.Node, origin: string, reason: string) {
    observations.push({ kind: 'indeterminate', origin, location: location(node), expression: node.getText(tree), reason });
  }
  function primitive(expression: ts.Expression, seen = new Set<ts.Symbol>()): string | number | undefined {
    const node = unwrap(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
      if (node.operator === ts.SyntaxKind.MinusToken) return -Number(node.operand.text);
      if (node.operator === ts.SyntaxKind.PlusToken) return Number(node.operand.text);
    }
    if (ts.isIdentifier(node)) {
      const binding = symbol(node);
      if (!binding || seen.has(binding)) return;
      seen.add(binding);
      const declaration = binding.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
        && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const) {
        return primitive(declaration.initializer, seen);
      }
    }
    return;
  }
  function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) {
      const value = primitive(name.expression);
      if (typeof value === 'string') return value;
    }
    return;
  }

  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    const localStylesheet = /^\.\.?\//.test(specifier) && /\.(css|scss)(?:[?#].*)?$/i.test(specifier);
    if (localStylesheet) {
      const stylesheet = posix.normalize(posix.join(posix.dirname(source.file), specifier.split(/[?#]/, 1)[0]!));
      observations.push({
        kind: 'resource', role: 'stylesheet', origin: 'react:stylesheet-import',
        source: { kind: 'file', value: posix.normalize(specifier.split(/[?#]/, 1)[0]!) }, location: location(statement.moduleSpecifier),
        context: 'static-code-reference',
      });
      if (/\.module\.(css|scss)(?:[?#].*)?$/i.test(specifier)) {
        const binding = clause?.name ?? (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name : undefined);
        const imported = binding && symbol(binding);
        if (imported) modules.set(imported, stylesheet);
      }
    }
    if (specifier === 'react' && clause) {
      if (clause.name) {
        const imported = symbol(clause.name);
        if (imported) reactNamespaces.add(imported);
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const imported = symbol(clause.namedBindings.name);
        if (imported) reactNamespaces.add(imported);
      } else if (clause.namedBindings) {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly || (element.propertyName ?? element.name).text !== 'createElement') continue;
          const imported = symbol(element.name);
          if (imported) createElements.add(imported);
        }
      }
    }
  }

  function styles(expression: ts.Expression) {
    const object = unwrap(expression);
    if (!ts.isObjectLiteralExpression(object)) {
      unknown(expression, 'react:style', 'Objet style non résolu statiquement.');
      return;
    }
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        unknown(property.expression, 'react:style', 'Le spread peut contenir ou remplacer des propriétés de police.');
        continue;
      }
      const name = propertyName(property.name);
      if (name === undefined) {
        unknown(property.name, 'react:style', 'Nom de propriété style non résolu statiquement.');
        continue;
      }
      if (!fontProperties.has(name)) continue;
      const valueNode = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
      if (!valueNode) {
        unknown(property, `react:style:${name}`, 'Propriété style non résolue statiquement.');
        continue;
      }
      const value = primitive(valueNode);
      if (value === undefined || (typeof value === 'number' && name !== 'fontWeight')) {
        unknown(valueNode, `react:style:${name}`, 'Expression JavaScript non résolue statiquement.');
        continue;
      }
      observations.push(...fontValue(name, String(value), location(property.name)));
    }
  }
  function isCreateElement(expression: ts.Expression): boolean {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const binding = symbol(node);
      return !!binding && createElements.has(binding);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'createElement') {
      const binding = symbol(node.expression);
      return !!binding && reactNamespaces.has(binding);
    }
    return false;
  }
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'style' && node.initializer) {
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) styles(node.initializer.expression);
      else unknown(node.initializer, 'react:style', 'Objet style non résolu statiquement.');
    }
    if (ts.isCallExpression(node) && isCreateElement(node.expression)) {
      const props = node.arguments[1] && unwrap(node.arguments[1]);
      if (props && ts.isObjectLiteralExpression(props)) {
        for (const property of props.properties) {
          if (ts.isPropertyAssignment(property) && propertyName(property.name) === 'style') styles(property.initializer);
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const binding = symbol(unwrap(node.expression));
      const stylesheet = binding && modules.get(binding);
      if (stylesheet) {
        const className = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && primitive(node.argumentExpression);
        if (typeof className === 'string') {
          observations.push({ kind: 'usage', origin: 'react:css-module', location: location(node),
            context: 'static-code-reference', cssModule: { stylesheet, className } });
        } else unknown(node, 'react:css-module', 'Nom de classe CSS Module non résolu statiquement.');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return observations;
}

/** Static React evidence only. Does not load React, Vite, Next.js or imported files. */
export const reactAnalyzer: Analyzer = { id: 'react', languages: ['js', 'jsx', 'ts', 'tsx'], analyze };
