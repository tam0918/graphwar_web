import {
  type FunctionToken,
  type TokenType,
  isUnaryFunction,
  isValueLike,
  isOperation,
  numParams,
  tokenOrder,
} from "./tokens";

export class MalformedFunctionError extends Error {
  constructor(message: string = "Malformed function") {
    super(message);
    this.name = "MalformedFunctionError";
  }
}

const TOKEN_RE = /[0-9]*\.?[0-9]+|\(|\)|x|y|y'|\+|\*|\/|\^|exp|sqrt|log|abs|sin|sen|cos|tan|tg|-|ln|e|pi/g;

const SUPERSCRIPT_MAP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
};

function stripCommonPrefixes(s: string): string {
  // Accept common user inputs: y=..., y'=..., y''=...
  // Server/game mode decides interpretation; we just strip LHS.
  return s
    .replace(/^\s*y\s*''\s*=\s*/, "")
    .replace(/^\s*y\s*''\s*/, "")
    .replace(/^\s*y\s*'\s*=\s*/, "")
    .replace(/^\s*y\s*'\s*/, "")
    .replace(/^\s*y\s*=\s*/, "")
    .replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/, "");
}

function normalizeInput(input: string): string {
  let s = input.toLowerCase();
  s = stripCommonPrefixes(s);
  s = s.trim();

  // Normalize common operator variants
  s = s.replaceAll("**", "^");
  s = s.replace(/[ˆ∧]/g, "^");
  s = s.replaceAll("×", "*");
  s = s.replaceAll("÷", "/");
  s = s.replaceAll(",", ".");

  // Normalize unicode superscripts: x² -> x^2, (x+1)³ -> (x+1)^3
  s = s.replace(/([a-z\)\]])\s*([⁰¹²³⁴⁵⁶⁷⁸⁹])/g, (_, base: string, sup: string) => {
    return `${base}^${SUPERSCRIPT_MAP[sup] ?? sup}`;
  });

  // Keep Graphwar-like unary-minus behavior: rewrite '-' into '+-'
  // (This intentionally accepts expressions like -2x^2 similar to original.)
  s = s.replaceAll("-", "+-");
  return s;
}

function makeToken(tok: string): FunctionToken {
  if (tok === "x") return { type: "VAR1" };
  if (tok === "y") return { type: "VAR2" };
  if (tok === "y'") return { type: "VAR3" };
  if (tok === "+") return { type: "ADD" };
  if (tok === "-") return { type: "SUBTRACT" };
  if (tok === "*") return { type: "MULTIPLY" };
  if (tok === "/") return { type: "DIVIDE" };
  if (tok === "^") return { type: "POW" };
  if (tok === "exp") return { type: "EXP" };
  if (tok === "sqrt") return { type: "SQRT" };
  if (tok === "log") return { type: "LOG" };
  if (tok === "abs") return { type: "ABS" };
  if (tok === "sin" || tok === "sen") return { type: "SIN" };
  if (tok === "cos") return { type: "COS" };
  if (tok === "tan" || tok === "tg") return { type: "TAN" };
  if (tok === "ln") return { type: "LN" };
  if (tok === "e") return { type: "VALUE", value: Math.E };
  if (tok === "pi") return { type: "VALUE", value: Math.PI };
  if (tok === "(") return { type: "LEFT_BRACKET" };
  if (tok === ")") return { type: "RIGHT_BRACKET" };

  const maybeNum = Number(tok);
  if (!Number.isNaN(maybeNum)) return { type: "VALUE", value: maybeNum };

  throw new MalformedFunctionError(`Unknown token: ${tok}`);
}

function isImplicit(type1: TokenType, type2: TokenType): boolean {
  // Port of Java isImplicit()
  if (isValueLike(type1) || type1 === "RIGHT_BRACKET") {
    if (isValueLike(type2) || type2 === "LEFT_BRACKET" || isUnaryFunction(type2)) {
      return true;
    }
  }
  return false;
}

function adjustImplicitMultiplications(tokens: FunctionToken[]): FunctionToken[] {
  if (tokens.length === 0) return tokens;

  const out: FunctionToken[] = [tokens[0]!];
  for (let i = 1; i < tokens.length; i++) {
    const last = out[out.length - 1]!;
    const next = tokens[i]!;

    if (isImplicit(last.type, next.type)) {
      out.push({ type: "MULTIPLY" });
    }

    out.push(next);
  }
  return out;
}

function valuesNeededForPolish(tokens: FunctionToken[]): number {
  // Port of getValuesNeeded()
  let valuesNeeded = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isOperation(t.type)) {
      valuesNeeded += numParams(t.type) - 1;
    } else {
      valuesNeeded--;
    }

    if (valuesNeeded === 0 && i + 1 < tokens.length) return -1;
  }
  return valuesNeeded;
}

function reorderToPolishNotation(funcTokens: FunctionToken[]): FunctionToken[] {
  const polish: FunctionToken[] = [];

  const reorderRec = (start: number, end: number): boolean => {
    if (start > end || start >= funcTokens.length) return false;

    let next = -1;
    let nextNest = Number.POSITIVE_INFINITY;
    let nest = 0;

    for (let i = start; i <= end; i++) {
      const t = funcTokens[i]!;
      if (t.type === "LEFT_BRACKET") nest++;
      else if (t.type === "RIGHT_BRACKET") nest--;
      else if (
        nest < nextNest ||
        (nest === nextNest && (next === -1 || tokenOrder(t.type) < tokenOrder(funcTokens[next]!.type)))
      ) {
        next = i;
        nextNest = nest;
      }
    }

    if (next === -1) return false;

    const op = funcTokens[next]!;
    switch (numParams(op.type)) {
      case 0: {
        polish.push(op);
        return true;
      }
      case 1: {
        polish.push(op);
        reorderRec(next + 1, end);
        return true;
      }
      case 2: {
        polish.push(op);
        const leftExists = reorderRec(start, next - 1);
        if (op.type === "ADD" && leftExists === false) {
          polish.push({ type: "VALUE", value: 0 });
        }
        reorderRec(next + 1, end);
        return true;
      }
    }
  };

  reorderRec(0, funcTokens.length - 1);
  return polish;
}

export function parseToPolishTokens(input: string): FunctionToken[] {
  const s = normalizeInput(input);
  const matches = s.match(TOKEN_RE) ?? [];
  const tokens = matches.map(makeToken);
  const withImplicit = adjustImplicitMultiplications(tokens);
  const polish = reorderToPolishNotation(withImplicit);

  if (valuesNeededForPolish(polish) !== 0) {
    throw new MalformedFunctionError();
  }

  return polish;
}
