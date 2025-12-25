export type TokenType =
  | "ADD"
  | "SUBTRACT"
  | "MULTIPLY"
  | "DIVIDE"
  | "POW"
  | "EXP"
  | "SQRT"
  | "LOG"
  | "ABS"
  | "SIN"
  | "COS"
  | "TAN"
  | "LN"
  | "VAR1" // x
  | "VAR2" // y
  | "VAR3" // y'
  | "VALUE"
  | "LEFT_BRACKET"
  | "RIGHT_BRACKET";

export type FunctionToken =
  | { type: Exclude<TokenType, "VALUE"> }
  | { type: "VALUE"; value: number };

export function tokenOrder(type: TokenType): number {
  // Mirrors Graphwar FunctionToken numeric ordering for precedence selection.
  switch (type) {
    case "ADD":
      return 1;
    case "SUBTRACT":
      return 2;
    case "MULTIPLY":
      return 3;
    case "DIVIDE":
      return 4;
    case "POW":
      return 5;
    case "EXP":
      return 6;
    case "SQRT":
      return 7;
    case "LOG":
      return 8;
    case "ABS":
      return 9;
    case "SIN":
      return 10;
    case "COS":
      return 11;
    case "TAN":
      return 12;
    case "LN":
      return 13;
    case "VAR1":
      return 14;
    case "VAR2":
      return 15;
    case "VAR3":
      return 16;
    case "VALUE":
      return 17;
    case "LEFT_BRACKET":
      return 18;
    case "RIGHT_BRACKET":
      return 19;
  }
}

export function isOperation(type: TokenType): boolean {
  return tokenOrder(type) >= 1 && tokenOrder(type) <= 13;
}

export function numParams(type: TokenType): 0 | 1 | 2 {
  // SUBTRACT is unary in Graphwar
  if (type === "SUBTRACT") return 1;
  if (["ADD", "MULTIPLY", "DIVIDE", "POW"].includes(type)) return 2;
  if (["EXP", "SQRT", "LOG", "ABS", "SIN", "COS", "TAN", "LN"].includes(type)) return 1;
  return 0;
}

export function isValueLike(type: TokenType): boolean {
  return type === "VALUE" || type === "VAR1" || type === "VAR2" || type === "VAR3";
}

export function isUnaryFunction(type: TokenType): boolean {
  return numParams(type) === 1 && isOperation(type);
}
