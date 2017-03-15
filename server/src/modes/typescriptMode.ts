import * as ts from 'typescript';
import { parseComponent } from "vue-template-compiler";

export function createUpdater() {
  const clssf = ts.createLanguageServiceSourceFile;
  const ulssf = ts.updateLanguageServiceSourceFile;
  function createLanguageServiceSourceFile(fileName: string, scriptSnapshot: ts.IScriptSnapshot, scriptTarget: ts.ScriptTarget, version: string, setNodeParents: boolean, scriptKind?: ts.ScriptKind): ts.SourceFile {
    let sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
    if (interested(fileName)) {
      modifyVueSource(sourceFile);
    }
    return sourceFile;
  }

  function updateLanguageServiceSourceFile(sourceFile: ts.SourceFile, scriptSnapshot: ts.IScriptSnapshot, version: string, textChangeRange: ts.TextChangeRange, aggressiveChecks?: boolean): ts.SourceFile {
    sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
    if (interested(sourceFile.fileName)) {
      modifyVueSource(sourceFile);
    }
    return sourceFile;
  }
  return { createLanguageServiceSourceFile, updateLanguageServiceSourceFile }
}

export function interested(filename: string): boolean {
  return filename.slice(filename.lastIndexOf('.')) === ".vue";
}

export function parse(text: string): string {
  const output = parseComponent(text, { pad: "space" });
  if (output && output.script && output.script.content) {
    return output.script.content;
  }
  else {
    return text;
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
  // 1. add `import Vue from './vue'
  // 2. find the export default and wrap it in `new Vue(...)` if it exists and is an object literal
  const exportDefaultObject = find(sourceFile.statements, st => st.kind === ts.SyntaxKind.ExportAssignment &&
    (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression);
  var b = <T extends ts.Node>(n: T) => ts.setTextRange(n, { pos: 0, end: 0 });
  if (exportDefaultObject) {
    //logger.info(exportDefaultObject.toString());
    const vueImport = b(ts.createImportDeclaration(undefined,
      undefined,
      b(ts.createImportClause(undefined,
        b(ts.createNamedImports([
          b(ts.createImportSpecifier(
            b(ts.createIdentifier("Vue")),
            b(ts.createIdentifier("Vue"))))])))),
      b(ts.createLiteral("./vue"))));
    sourceFile.statements.unshift(vueImport);
    const obj = (exportDefaultObject as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
    (exportDefaultObject as ts.ExportAssignment).expression = ts.setTextRange(ts.createNew(ts.setTextRange(ts.createIdentifier("Vue"), { pos: obj.pos, end: obj.pos + 1 }),
      undefined,
      [obj]),
      obj);
    ts.setTextRange(((exportDefaultObject as ts.ExportAssignment).expression as ts.NewExpression).arguments, obj);
  }
}