import * as ts from 'typescript';
import path = require('path');
import { parseComponent } from "vue-template-compiler";

export function isVue(filename: string): boolean {
  return path.extname(filename) === '.vue';
}

export function parseVue(text: string): string {
  const output = parseComponent(text, { pad: 'space' });
  if (output && output.script && output.script.content) {
    return output.script.content;
  }
  else {
    return text;
  }
}

export function createUpdater() {
  const clssf = ts.createLanguageServiceSourceFile;
  const ulssf = ts.updateLanguageServiceSourceFile;
  return {
    createLanguageServiceSourceFile(fileName: string, scriptSnapshot: ts.IScriptSnapshot, scriptTarget: ts.ScriptTarget, version: string, setNodeParents: boolean, scriptKind?: ts.ScriptKind): ts.SourceFile {
      let sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
      if (isVue(fileName)) {
        modifyVueSource(sourceFile);
      }
      return sourceFile;
    },
    updateLanguageServiceSourceFile(sourceFile: ts.SourceFile, scriptSnapshot: ts.IScriptSnapshot, version: string, textChangeRange: ts.TextChangeRange, aggressiveChecks?: boolean): ts.SourceFile {
      sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
      if (isVue(sourceFile.fileName)) {
        modifyVueSource(sourceFile);
      }
      return sourceFile;
    }
  }
}

/** Works like Array.prototype.find, returning `undefined` if no element satisfying the predicate is found. */
function find<T>(array: T[], predicate: (element: T, index: number) => boolean): T | undefined {
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    if (predicate(value, i)) {
      return value;
    }
  }
  return undefined;
}

function modifyVueSource(sourceFile: ts.SourceFile): void {
  const exportDefaultObject = find(sourceFile.statements, st => st.kind === ts.SyntaxKind.ExportAssignment &&
    (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression);
  if (exportDefaultObject) {
    // 1. add `import Vue from './vue'
    //       (the span of the statement is (0,0) to avoid overlapping existing statements)
    const zero = <T extends ts.Node>(n: T) => ts.setTextRange(n, { pos: 0, end: 0 });
    const vueImport = zero(ts.createImportDeclaration(undefined,
      undefined,
      zero(ts.createImportClause(undefined,
        zero(ts.createNamedImports([
          zero(ts.createImportSpecifier(
            zero(ts.createIdentifier('Vue')),
            zero(ts.createIdentifier('Vue'))))])))),
      zero(ts.createLiteral('vue'))));
    sourceFile.statements.unshift(vueImport);

    // 2. find the export default and wrap it in `new Vue(...)` if it exists and is an object literal
    //       (the span of the construct call is the same as the object literal)
    const objectLiteral = (exportDefaultObject as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
    const o = <T extends ts.TextRange>(n: T) => ts.setTextRange(n, objectLiteral);
    const vue = ts.setTextRange(ts.createIdentifier('Vue'), { pos: objectLiteral.pos, end: objectLiteral.pos + 1 });
    (exportDefaultObject as ts.ExportAssignment).expression = o(ts.createNew(vue, undefined, [objectLiteral]));
    o(((exportDefaultObject as ts.ExportAssignment).expression as ts.NewExpression).arguments);
  }
}