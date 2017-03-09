import * as ts from 'typescript';
import { parseComponent } from "vue-template-compiler";

type Path = string & { __pathBrand: any };

// TODO: Using workspacePath, walk up from the current file and find the tsconfig. To do this,
// in server/editorServices, first findConfigFile then convertConfigFileContentToProjectOptions.
// this will let you rewrite the host below to have compilerOptions and the correct list of files.
// Note that I'll also need a correct Map<number> to track scriptFileVersion, because the current one only has one (1) file.
// getScriptKind will also need to use the original filename, plus look at the current region's lang attribute.
// getScriptSnapshot will need the sanitising code instead of updateCurrentTextDocument (though I am not sure this will work)

// THEN try adding a host API hook for the language service to call to create source files, and inside here
// add createLanguageServiceSourceFile should do the hooking and so on.

/** 
 * This is different from the method the compiler uses because
 * the compiler can assume it will always start searching in the
 * current directory (the directory in which tsc was invoked).
 * The server must start searching from the directory containing
 * the newly opened file.
 */
export function findConfigFile(this: void, host: ts.LanguageServiceHost, searchPath: string): string {
  while (true) {
    const tsconfigFileName = combinePaths(searchPath, "tsconfig.json");
    if (host.fileExists(tsconfigFileName)) {
      return tsconfigFileName;
    }

    const jsconfigFileName = combinePaths(searchPath, "jsconfig.json");
    if (host.fileExists(jsconfigFileName)) {
      return jsconfigFileName;
    }

    const parentPath = getDirectoryPath(searchPath);
    if (parentPath === searchPath) {
      break;
    }
    searchPath = parentPath;
  }
  return undefined;
}
/**
 * Returns the path except for its basename. Eg:
 *
 * /path/to/file.ext -> /path/to
 */
function getDirectoryPath(path: Path): Path;
function getDirectoryPath(path: string): string;
function getDirectoryPath(path: string): string {
  return path.substr(0, Math.max(getRootLength(path), path.lastIndexOf(directorySeparator)));
}


function combinePaths(path1: string, path2: string) {
  if (!(path1 && path1.length)) return path2;
  if (!(path2 && path2.length)) return path1;
  if (getRootLength(path2) !== 0) return path2;
  if (path1.charAt(path1.length - 1) === directorySeparator) return path1 + path2;
  return path1 + directorySeparator + path2;
}

enum CharacterCodes {
  slash = 0x2F,                 // /
  colon = 0x3A,                 // :
}

const directorySeparator = "/"; // lol!

/**
 * Returns length of path root (i.e. length of "/", "x:/", "//server/share/, file:///user/files")
 */
function getRootLength(path: string): number {
  if (path.charCodeAt(0) === CharacterCodes.slash) {
    if (path.charCodeAt(1) !== CharacterCodes.slash) return 1;
    const p1 = path.indexOf("/", 2);
    if (p1 < 0) return 2;
    const p2 = path.indexOf("/", p1 + 1);
    if (p2 < 0) return p1 + 1;
    return p2 + 1;
  }
  if (path.charCodeAt(1) === CharacterCodes.colon) {
    if (path.charCodeAt(2) === CharacterCodes.slash) return 3;
    return 2;
  }
  // Per RFC 1738 'file' URI schema has the shape file://<host>/<path>
  // if <host> is omitted then it is assumed that host value is 'localhost',
  // however slash after the omitted <host> is not removed.
  // file:///folder1/file1 - this is a correct URI
  // file://folder2/file2 - this is an incorrect URI
  if (path.lastIndexOf("file:///", 0) === 0) {
    return "file:///".length;
  }
  const idx = path.indexOf("://");
  if (idx !== -1) {
    return idx + "://".length;
  }
  return 0;
}

///////////////////// basically copied from vue-ts-plugin /////////////////////
export function createUpdater(clssf, ulssf) {
  function createLanguageServiceSourceFile(fileName: string, scriptSnapshot: ts.IScriptSnapshot, scriptTarget: ts.ScriptTarget, version: string, setNodeParents: boolean, scriptKind?: ts.ScriptKind, cheat?: string): ts.SourceFile {
    if (interested(fileName)) {
      const wrapped = scriptSnapshot;
      scriptSnapshot = {
        getChangeRange: old => wrapped.getChangeRange(old),
        getLength: () => wrapped.getLength(),
        getText: (start, end) => parse(wrapped.getText(0, wrapped.getLength())).slice(start, end),
      };
    }
    var sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
    if (interested(fileName)) {
      modifyVueSource(sourceFile);
    }
    return sourceFile;
  }

  function updateLanguageServiceSourceFile(sourceFile: ts.SourceFile, scriptSnapshot: ts.IScriptSnapshot, version: string, textChangeRange: ts.TextChangeRange, aggressiveChecks?: boolean, cheat?: string): ts.SourceFile {
    if (interested(sourceFile.fileName)) {
      const wrapped = scriptSnapshot;
      scriptSnapshot = {
        getChangeRange: old => wrapped.getChangeRange(old),
        getLength: () => wrapped.getLength(),
        getText: (start, end) => parse(wrapped.getText(0, wrapped.getLength())).slice(start, end),
      };
    }
    sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
    if (interested(sourceFile.fileName)) {
      modifyVueSource(sourceFile);
    }
    return sourceFile;
  }
  return { createLanguageServiceSourceFile, updateLanguageServiceSourceFile }
}

function interested(filename: string): boolean {
  // TODO: synthetic filename is not a good solution since imports don't work
  return filename.slice(filename.lastIndexOf('.')) === ".vue"; // || filename === "vscode://javascript/1";
}

//function importInterested(filename: string): boolean {
  //return interested(filename) && filename.slice(0, 2) === "./";
//}

function parse(text: string) {
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

function normalizePath(path: string): string {
    path = normalizeSlashes(path);
    const rootLength = getRootLength(path);
    const root = path.substr(0, rootLength);
    const normalized = getNormalizedParts(path, rootLength);
    if (normalized.length) {
        const joinedParts = root + normalized.join(directorySeparator);
        return pathEndsWithDirectorySeparator(path) ? joinedParts + directorySeparator : joinedParts;
    }
    else {
        return root;
    }
}
function normalizeSlashes(path: string): string {
    return path.replace(/\\/g, "/");
}

function getNormalizedParts(normalizedSlashedPath: string, rootLength: number): string[] {
    const parts = normalizedSlashedPath.substr(rootLength).split(directorySeparator);
    const normalized: string[] = [];
    for (const part of parts) {
        if (part !== ".") {
            if (part === ".." && normalized.length > 0 && lastOrUndefined(normalized) !== "..") {
                normalized.pop();
            }
            else {
                // A part may be an empty string (which is 'falsy') if the path had consecutive slashes,
                // e.g. "path//file.ts".  Drop these before re-joining the parts.
                if (part) {
                    normalized.push(part);
                }
            }
        }
    }

    return normalized;
}

/**
 * Returns the last element of an array if non-empty, `undefined` otherwise.
 */
function lastOrUndefined<T>(array: T[]): T {
    return array && array.length > 0
        ? array[array.length - 1]
        : undefined;
}

function some<T>(array: T[], predicate?: (value: T) => boolean): boolean {
    if (array) {
        if (predicate) {
            for (const v of array) {
                if (predicate(v)) {
                    return true;
                }
            }
        }
        else {
            return array.length > 0;
        }
    }
    return false;
}

function concatenate<T>(array1: T[], array2: T[]): T[] {
    if (!some(array2)) return array1;
    if (!some(array1)) return array2;
    return [...array1, ...array2];
}

const directorySeparatorCharCode = CharacterCodes.slash;

/** A path ending with '/' refers to a directory only, never a file. */
function pathEndsWithDirectorySeparator(path: string): boolean {
    return path.charCodeAt(path.length - 1) === directorySeparatorCharCode;
}
export function simpleParseJsonConfigFileContent(host: ts.LanguageServiceHost, configFilename: string) {
    configFilename = normalizePath(configFilename);
    const configFileContent = host.readFile(configFilename);
    const result = ts.parseConfigFileTextToJson(configFilename, configFileContent);
    let config = result.config;
    let errors: ts.Diagnostic[];
    if (result.error) {
        // try to reparse config file
        const { configJsonObject: sanitizedConfig, diagnostics } = sanitizeConfigFile(configFilename, configFileContent);
        config = sanitizedConfig;
        errors = diagnostics.length ? diagnostics : [result.error];
    }

   const parseConfigHost: ts.ParseConfigHost = {
        useCaseSensitiveFileNames: host.useCaseSensitiveFileNames(),
        readDirectory: host.readDirectory,
        fileExists: host.fileExists,
        readFile: host.readFile,
    }
    const parsedCommandLine = ts.parseJsonConfigFileContent(
        config,
        parseConfigHost,
        getDirectoryPath(configFilename),
        /*existingOptions*/ {},
        configFilename,
        /*resolutionStack*/[],
        [{ extension: "vue", isMixedContent: true }]);
    return parsedCommandLine.fileNames;
}

function sanitizeConfigFile(configFileName: string, content: string) {
    const options: ts.TranspileOptions = {
        fileName: "config.js",
        compilerOptions: {
            target: ts.ScriptTarget.ES2015,
            removeComments: true
        },
        reportDiagnostics: true
    };
    const { outputText, diagnostics } = ts.transpileModule("(" + content + ")", options);
    // Becasue the content was wrapped in "()", the start position of diagnostics needs to be subtract by 1
    // also, the emitted result will have "(" in the beginning and ");" in the end. We need to strip these
    // as well
    const trimmedOutput = outputText.trim();
    for (const diagnostic of diagnostics) {
        diagnostic.start = diagnostic.start - 1;
    }
    const { config, error } = ts.parseConfigFileTextToJson(configFileName, trimmedOutput.substring(1, trimmedOutput.length - 2), /*stripComments*/ false);
    return {
        configJsonObject: config || {},
        diagnostics: error ? concatenate(diagnostics, [error]) : diagnostics
    };
}