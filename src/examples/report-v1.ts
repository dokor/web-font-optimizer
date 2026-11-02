import type { AuditReportV1, Location } from '../contracts.js';

const location: Location = { file: 'src/body.css', line: 2, column: 3 };

export const exampleReport = {
  version: 1,
  inventory: {
    observations: [{
      kind: 'usage', origin: 'font-family', location,
      family: 'Atlas', familyStack: ['Atlas', 'serif'],
    }],
    resources: [],
  },
  diagnostics: [{
    ruleId: 'undeclared-family', severity: 'warning', confidence: 'possible',
    locations: [location], message: 'Aucune déclaration connue pour Atlas.',
    advice: 'Vérifier si Atlas est fournie par une feuille externe.',
  }],
} as const satisfies AuditReportV1;
