import ts from 'typescript';
import type { Analyzer, FontSource, Observation, SourceFile, Variant } from '../../contracts.js';

type Loader = { origin: 'next/font/google' | 'next/font/local'; family?: string };
type Instance = Loader & { family: string; context: string; variable?: string };
type Member = { instance: Instance; property: 'className' | 'style' | 'variable' };
type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    node = node.expression;
  }
  return node;
}

function key(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression)) return node.expression.text;
  return undefined;
}

function access(node: ts.Expression): { base: ts.Expression; property: string } | undefined {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return { base: node.expression, property: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return { base: node.expression, property: node.argumentExpression.text };
  }
  return undefined;
}

function constant(node: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

/** A single-file parser/binder. The host cannot read the disk or resolve imports. */
function bind(source: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: name => name === source.fileName ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: name => name === source.fileName,
    readFile: () => undefined, getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  return ts.createProgram([source.fileName], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
}

function analyze(input: SourceFile): Observation[] {
  const kinds = { js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX };
  if (!(input.language in kinds)) return [];
  const source = ts.createSourceFile(input.file, input.text, ts.ScriptTarget.Latest, true,
    kinds[input.language as keyof typeof kinds]);
  const imports = source.statements.filter(ts.isImportDeclaration).filter(node =>
    ts.isStringLiteral(node.moduleSpecifier) &&
    ['next/font/google', 'next/font/local'].includes(node.moduleSpecifier.text) &&
    node.importClause && !node.importClause.isTypeOnly);
  if (!imports.length) return [];

  const checker = bind(source);
  const observations: Observation[] = [];
  const loaders = new Map<ts.Symbol, Loader>();
  const namespaces = new Map<ts.Symbol, Loader['origin']>();
  const instances = new Map<ts.CallExpression, Instance>();
  const symbol = (node: ts.Node) => checker.getSymbolAtLocation(node);
  const location = (node: ts.Node, offset = node.getStart(source)) => {
    const point = source.getLineAndCharacterOfPosition(offset);
    return { file: input.file, line: point.line + 1, column: point.character + 1 };
  };
  function uncertain(node: ts.Node, reason: string, instance?: Instance) {
    observations.push({ kind: 'indeterminate', origin: instance?.origin ?? 'next/font',
      location: location(node), expression: node.getText(source), reason,
      ...(instance ? { family: instance.family, context: instance.context } : {}) });
  }

  for (const node of imports) {
    const origin = (node.moduleSpecifier as ts.StringLiteral).text as Loader['origin'];
    const clause = node.importClause!;
    if (clause.name && origin === 'next/font/local') {
      const id = symbol(clause.name);
      if (id) loaders.set(id, { origin });
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const id = symbol(clause.namedBindings.name);
      if (id) namespaces.set(id, origin);
    } else if (clause.namedBindings) {
      for (const binding of clause.namedBindings.elements) {
        if (binding.isTypeOnly) continue;
        const name = (binding.propertyName ?? binding.name).text;
        const id = symbol(binding.name);
        if (id && (origin === 'next/font/google' || name === 'default')) {
          loaders.set(id, { origin, ...(origin === 'next/font/google' ? { family: name.replaceAll('_', ' ') } : {}) });
        }
      }
    }
  }

  if (!loaders.size && !namespaces.size) return [];

  function loader(node: ts.Expression, seen = new Set<ts.Symbol>()): Loader | undefined {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const id = symbol(node);
      if (!id || seen.has(id)) return undefined;
      if (loaders.has(id)) return loaders.get(id);
      seen.add(id);
      const declaration = id.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && constant(declaration) && declaration.initializer) {
        return loader(declaration.initializer, seen);
      }
    }
    const member = access(node);
    if (member) {
      const id = symbol(unwrap(member.base));
      const origin = id && namespaces.get(id);
      if (origin && (origin === 'next/font/google' || member.property === 'default')) {
        return { origin, ...(origin === 'next/font/google' ? { family: member.property.replaceAll('_', ' ') } : {}) };
      }
    }
    return undefined;
  }

  function literal(node: ts.Expression, instance: Instance): Literal | undefined {
    node = unwrap(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(item => literal(item, instance));
      return values.every(value => value !== undefined) ? values as Literal[] : undefined;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result: { [key: string]: Literal } = Object.create(null);
      let complete = true;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || key(property.name) === undefined) {
          uncertain(property, 'Dynamic object property cannot be resolved statically.', instance);
          complete = false;
          continue;
        }
        const value = literal(property.initializer, instance);
        if (value === undefined) complete = false;
        else result[key(property.name)!] = value;
      }
      return complete ? result : undefined;
    }
    uncertain(node, 'Dynamic option cannot be resolved statically.', instance);
    return undefined;
  }

  function options(node: ts.Expression, instance: Instance): Map<string, ts.Expression> {
    node = unwrap(node);
    const result = new Map<string, ts.Expression>();
    if (!ts.isObjectLiteralExpression(node)) {
      uncertain(node, 'Expected an explicit options object.', instance);
      return result;
    }
    for (const property of node.properties) {
      const name = property.name && key(property.name);
      if (ts.isSpreadAssignment(property) || name === undefined) {
        // An unknown spread/key may override any preceding option.
        result.clear();
        uncertain(property, 'Dynamic options may override preceding properties.', instance);
      } else if (ts.isPropertyAssignment(property)) result.set(name, property.initializer);
      else {
        result.delete(name);
        uncertain(property, 'Expected an explicit option value.', instance);
      }
    }
    return result;
  }

  function strings(value: Literal | undefined): string[] | undefined {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value as string[];
    return undefined;
  }

  function variants(values: Map<string, Literal | undefined>): Variant[] {
    let result: Variant[] = [{}];
    for (const [option, field] of [['weight', 'weight'], ['style', 'style'], ['subsets', 'subset']] as const) {
      const items = strings(values.get(option));
      if (items?.length) result = result.flatMap(variant => items.map(value => ({ ...variant, [field]: value })));
    }
    return result.length === 1 && !Object.keys(result[0]!).length ? [] : result;
  }

  function declare(call: ts.CallExpression, definition: Loader) {
    const point = location(call);
    const context = `${input.file}:${point.line}:${point.column}`;
    const instance: Instance = { ...definition, family: definition.family ?? `local:${context}`, context };
    instances.set(call, instance);
    if (call.questionDotToken || call.arguments.length > 1 || call.typeArguments?.length) {
      uncertain(call, 'Unsupported loader invocation.', instance);
      return;
    }
    const entries = call.arguments[0] ? options(call.arguments[0], instance) : new Map<string, ts.Expression>();
    const values = new Map<string, Literal | undefined>();
    for (const [name, expression] of entries) if (name !== 'src') values.set(name, literal(expression, instance));
    const display = values.get('display');
    const variable = values.get('variable');
    if (typeof variable === 'string') {
      instance.variable = variable;
      observations.push({ kind: 'variable', action: 'define', origin: instance.origin,
        family: instance.family, context, name: variable, value: instance.family,
        location: location(entries.get('variable')!) });
    }
    const evidence = { origin: instance.origin, family: instance.family, context };
    const presentation = typeof display === 'string' ? { display } : {};
    const defaults = variants(values);
    if (definition.origin === 'next/font/google') {
      observations.push({ kind: 'declaration', ...evidence, ...presentation, location: point,
        ...(defaults.length ? { variants: defaults } : {}) });
      return;
    }
    const src = entries.get('src');
    if (!src) {
      if (!call.arguments[0] || ts.isObjectLiteralExpression(unwrap(call.arguments[0]))) {
        uncertain(call, 'Local font source is missing or unresolved.', instance);
      }
      observations.push({ kind: 'declaration', ...evidence, ...presentation, location: point });
      return;
    }
    const sources = unwrap(src);
    const items = ts.isArrayLiteralExpression(sources) ? sources.elements : [sources];
    if (!items.length) uncertain(src, 'Local font source list is empty.', instance);
    for (const item of items) {
      const value = unwrap(item);
      const descriptors = ts.isObjectLiteralExpression(value) ? options(value, instance) : undefined;
      const pathNode = descriptors?.get('path') ?? (descriptors ? undefined : value);
      const path = pathNode && literal(pathNode, instance);
      if (typeof path !== 'string') {
        if (path !== undefined || !pathNode) uncertain(item, 'Expected an explicit local font path.', instance);
        continue;
      }
      const selected = new Map(values);
      if (descriptors) for (const [name, expression] of descriptors) {
        if (name !== 'path') selected.set(name, literal(expression, instance));
      }
      const perSource = variants(selected);
      const fontSource: FontSource = { kind: 'file', value: path };
      const shared = { ...evidence, location: location(item), ...(perSource.length ? { variants: perSource } : {}) };
      observations.push({ kind: 'declaration', ...shared, ...presentation, sources: [fontSource] });
      observations.push({ kind: 'resource', ...shared, role: 'font', source: fontSource, declarationLocation: shared.location });
    }
  }

  function collect(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const definition = loader(node.expression);
      if (definition) declare(node, definition);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);

  function instanceOf(node: ts.Expression, seen = new Set<ts.Symbol>()): Instance | undefined {
    node = unwrap(node);
    if (ts.isCallExpression(node)) return instances.get(node);
    if (!ts.isIdentifier(node)) return undefined;
    const id = symbol(node);
    if (!id || seen.has(id)) return undefined;
    seen.add(id);
    const declaration = id.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && constant(declaration) && declaration.initializer) {
      return instanceOf(declaration.initializer, seen);
    }
    return undefined;
  }

  function memberOf(node: ts.Expression, seen = new Set<ts.Symbol>()): Member | undefined {
    node = unwrap(node);
    const member = access(node);
    if (member) {
      const instance = instanceOf(member.base);
      if (instance && ['className', 'style', 'variable'].includes(member.property)) {
        return { instance, property: member.property as Member['property'] };
      }
      if (member.property === 'fontFamily') {
        const parent = memberOf(member.base, seen);
        if (parent?.property === 'style') return parent;
      }
    }
    if (!ts.isIdentifier(node)) return undefined;
    const id = symbol(node);
    if (!id || seen.has(id)) return undefined;
    seen.add(id);
    const declaration = id.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && constant(declaration) && declaration.initializer) {
      return memberOf(declaration.initializer, seen);
    }
    if (declaration && ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent) && constant(declaration.parent.parent) &&
      !declaration.dotDotDotToken && !declaration.initializer) {
      const variable = declaration.parent.parent;
      const instance = variable.initializer && instanceOf(variable.initializer);
      const property = key(declaration.propertyName ?? declaration.name as ts.PropertyName);
      if (instance && property && ['className', 'style', 'variable'].includes(property)) {
        return { instance, property: property as Member['property'] };
      }
    }
    return undefined;
  }

  function use(node: ts.Node, member: Member) {
    const { instance, property } = member;
    const evidence = { family: instance.family, context: instance.context, location: location(node) };
    if (property === 'variable') {
      if (instance.variable) observations.push({ kind: 'variable', action: 'reference',
        origin: 'next/font/variable', ...evidence, name: instance.variable });
      else uncertain(node, 'CSS variable name is not explicit on this instance.', instance);
    } else observations.push({ kind: 'usage', origin: `next/font/${property}`, ...evidence });
  }

  function jsx(node: ts.Node) {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) &&
      ['className', 'style'].includes(node.name.text) && node.initializer &&
      ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const attribute = node.name.text;
      function visit(expression: ts.Node) {
        if (ts.isExpression(expression)) {
          const member = memberOf(expression);
          if (member) {
            if ((attribute === 'style') === (member.property === 'style')) use(expression, member);
            return;
          }
        }
        // Inline CSS consumes a variable, while .variable only exposes it.
        if (attribute === 'style' && ts.isPropertyAssignment(expression) &&
          ['fontFamily', 'font-family'].includes(key(expression.name) ?? '')) {
          const value = unwrap(expression.initializer);
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            for (const match of value.text.matchAll(/var\(\s*(--[\w-]+)/g)) {
              observations.push({ kind: 'variable', action: 'reference', origin: 'font-family',
                location: location(value), name: match[1]! });
            }
          }
        }
        ts.forEachChild(expression, visit);
      }
      visit(node.initializer.expression);
      return;
    }
    ts.forEachChild(node, jsx);
  }
  jsx(source);
  return observations.sort((a, b) => a.location.line - b.location.line || a.location.column - b.location.column);
}

/** Static adapter, also included in the production registry. */
export const nextAnalyzer: Analyzer = {
  id: 'next-font', languages: ['js', 'jsx', 'ts', 'tsx'], analyze,
};
