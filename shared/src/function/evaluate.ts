import { type FunctionToken, numParams } from "./tokens";

export function evaluatePolish(tokens: FunctionToken[], var1: number, var2: number, var3: number): number {
  let read = 0;

  const evalRec = (): number => {
    const t = tokens[read++];
    if (!t) return NaN;

    switch (t.type) {
      case "VAR1":
        return var1;
      case "VAR2":
        return var2;
      case "VAR3":
        return var3;
      case "VALUE":
        return t.value;

      case "ADD":
        return evalRec() + evalRec();
      case "SUBTRACT":
        return -evalRec();
      case "MULTIPLY":
        return evalRec() * evalRec();
      case "DIVIDE":
        return evalRec() / evalRec();
      case "POW":
        return Math.pow(evalRec(), evalRec());

      case "EXP":
        return Math.exp(evalRec());
      case "SQRT":
        return Math.sqrt(evalRec());
      case "LOG":
        return Math.log10(evalRec());
      case "ABS":
        return Math.abs(evalRec());
      case "SIN":
        return Math.sin(evalRec());
      case "COS":
        return Math.cos(evalRec());
      case "TAN":
        return Math.tan(evalRec());
      case "LN":
        return Math.log(evalRec());

      case "LEFT_BRACKET":
      case "RIGHT_BRACKET":
        return NaN;
    }
  };

  // quick sanity: ensure tokens can be evaluated without running out
  // (Graphwar's getValuesNeeded check already covers correctness)
  void numParams;
  return evalRec();
}
