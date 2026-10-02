import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const COPY_TARGET = {
  file: "src/lib/appCopy.ts",
  variable: "APP_COPY",
};

function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression?.(current)
  ) {
    current = current.expression;
  }
  return current;
}

function readPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function collectErrors(node, shapePath, errors) {
  const current = unwrap(node);

  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) {
        errors.push(`${shapePath}: unsupported property kind ${ts.SyntaxKind[property.kind]}`);
        continue;
      }
      const name = readPropertyName(property.name);
      if (!name) {
        errors.push(`${shapePath}: unsupported property name`);
        continue;
      }
      collectErrors(property.initializer, `${shapePath}.${name}`, errors);
    }
    return;
  }

  if (ts.isArrayLiteralExpression(current)) {
    current.elements.forEach((element, index) => collectErrors(element, `${shapePath}[${index}]`, errors));
    return;
  }

  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    if (current.text.trim().length === 0) {
      errors.push(`${shapePath}: empty string is not allowed`);
    }
    return;
  }

  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return;
  }

  if (current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword) {
    return;
  }

  if (ts.isNumericLiteral(current)) {
    return;
  }

  errors.push(`${shapePath}: unsupported value kind ${ts.SyntaxKind[current.kind]}`);
}

function findDictionaryVariable(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== variableName || !declaration.initializer) {
        continue;
      }
      return unwrap(declaration.initializer);
    }
  }
  return null;
}

function validateCopy(projectRoot, descriptor) {
  const errors = [];
  const filePath = path.join(projectRoot, descriptor.file);
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dictionaryNode = findDictionaryVariable(sourceFile, descriptor.variable);

  if (!dictionaryNode || !ts.isObjectLiteralExpression(dictionaryNode)) {
    return [`${descriptor.file}: could not find object literal for ${descriptor.variable}`];
  }

  collectErrors(dictionaryNode, descriptor.variable, errors);
  return errors.map((message) => `${descriptor.file}: ${message}`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = validateCopy(projectRoot, COPY_TARGET);

if (failures.length > 0) {
  console.error("Localization check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Localization check passed for ${COPY_TARGET.variable}.`);
