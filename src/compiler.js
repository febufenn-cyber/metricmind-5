import { compileSemanticQuery } from './semantic-compiler.js';

export function compileQuery(plan, workspace) {
  return compileSemanticQuery(plan, workspace);
}
