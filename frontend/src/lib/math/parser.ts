/**
 * Math Parser Engine
 * Safely parses and evaluates user-defined mathematical functions
 * Returns Vietnamese error messages for invalid input
 */

import { create, all, MathNode, ConstantNode, SymbolNode, FunctionNode, OperatorNode, ParenthesisNode } from 'mathjs';
import { Point, ParseResult, GridConfig, MATH_ERRORS, DEFAULT_GRID_CONFIG, GAME_CONSTANTS } from '@/types';

// Create a mathjs instance with limited scope for security
const math = create(all);

// Allowed functions whitelist for security
const ALLOWED_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'abs', 'log', 'log10', 'log2',
  'exp', 'pow', 'floor', 'ceil', 'round',
  'min', 'max', 'sign',
]);

// Allowed operators
const ALLOWED_OPERATORS = new Set([
  '+', '-', '*', '/', '^', 'unaryMinus', 'unaryPlus',
]);

/**
 * Validates the AST to ensure only allowed functions and operators are used
 */
function validateAST(node: MathNode): { valid: boolean; error?: string } {
  if (node.type === 'ConstantNode') {
    return { valid: true };
  }

  if (node.type === 'SymbolNode') {
    const symbolNode = node as SymbolNode;
    // Only 'x' is allowed as a variable
    if (symbolNode.name !== 'x' && symbolNode.name !== 'e' && symbolNode.name !== 'pi') {
      return { valid: false, error: `${MATH_ERRORS.UNDEFINED_VARIABLE}: "${symbolNode.name}"` };
    }
    return { valid: true };
  }

  if (node.type === 'FunctionNode') {
    const funcNode = node as FunctionNode;
    if (!ALLOWED_FUNCTIONS.has(funcNode.fn.name)) {
      return { valid: false, error: `${MATH_ERRORS.UNKNOWN_FUNCTION}: "${funcNode.fn.name}"` };
    }
    // Validate function arguments
    for (const arg of funcNode.args) {
      const result = validateAST(arg);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  if (node.type === 'OperatorNode') {
    const opNode = node as OperatorNode;
    if (!ALLOWED_OPERATORS.has(opNode.op) && !ALLOWED_OPERATORS.has(opNode.fn)) {
      return { valid: false, error: `${MATH_ERRORS.INVALID_SYNTAX}: "${opNode.op}"` };
    }
    // Validate operands
    for (const arg of opNode.args) {
      const result = validateAST(arg);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  if (node.type === 'ParenthesisNode') {
    const parenNode = node as ParenthesisNode;
    return validateAST(parenNode.content);
  }

  return { valid: true };
}

/**
 * Sanitizes the input string before parsing
 */
function sanitizeInput(input: string): string {
  let sanitized = input.trim().toLowerCase();
  
  // Remove "y=" or "f(x)=" prefix if present
  sanitized = sanitized.replace(/^y\s*=\s*/, '');
  sanitized = sanitized.replace(/^f\s*\(\s*x\s*\)\s*=\s*/, '');
  
  // Replace common alternatives
  sanitized = sanitized.replace(/\*\*/g, '^'); // ** to ^
  sanitized = sanitized.replace(/÷/g, '/');     // Division symbol
  sanitized = sanitized.replace(/×/g, '*');     // Multiplication symbol
  
  return sanitized;
}

/**
 * Checks if a value is a valid finite number
 */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && !isNaN(value);
}

/**
 * Main function to parse a mathematical expression and generate points
 */
export function parseMathFunction(
  input: string,
  startX: number,
  endX: number,
  gridConfig: GridConfig = DEFAULT_GRID_CONFIG
): ParseResult {
  // Check for empty input
  if (!input || input.trim() === '') {
    return {
      success: false,
      points: [],
      error: MATH_ERRORS.EMPTY_INPUT,
    };
  }

  const sanitizedInput = sanitizeInput(input);

  try {
    // Parse the expression into an AST
    const parsed = math.parse(sanitizedInput);

    // Validate the AST for security
    const validation = validateAST(parsed);
    if (!validation.valid) {
      return {
        success: false,
        points: [],
        error: validation.error,
      };
    }

    // Compile the expression for efficient evaluation
    const compiled = parsed.compile();

    // Generate points
    const points: Point[] = [];
    const step = GAME_CONSTANTS.PATH_RESOLUTION;

    for (let x = startX; x <= endX; x += step) {
      try {
        const scope = { x, e: Math.E, pi: Math.PI };
        const y = compiled.evaluate(scope);

        // Check for valid result
        if (!isValidNumber(y)) {
          // Skip invalid points (like division by zero at specific x)
          continue;
        }

        // Check for complex numbers (mathjs can return these)
        if (typeof y === 'object' && y !== null) {
          // Skip complex results
          continue;
        }

        // Check if within reasonable bounds
        if (Math.abs(y) > 1000) {
          // Skip extremely large values to prevent rendering issues
          continue;
        }

        points.push({ x, y });
      } catch {
        // Skip points that cause evaluation errors (e.g., log of negative number)
        continue;
      }
    }

    // Check if we got any valid points
    if (points.length === 0) {
      return {
        success: false,
        points: [],
        error: MATH_ERRORS.INVALID_RESULT,
      };
    }

    return {
      success: true,
      points,
    };
  } catch (error) {
    // Parse error
    const errorMessage = error instanceof Error ? error.message : '';
    
    if (errorMessage.includes('Unexpected end')) {
      return {
        success: false,
        points: [],
        error: `${MATH_ERRORS.INVALID_SYNTAX}: Biểu thức chưa hoàn chỉnh`,
      };
    }
    
    if (errorMessage.includes('Unexpected')) {
      return {
        success: false,
        points: [],
        error: `${MATH_ERRORS.INVALID_SYNTAX}: Ký tự không hợp lệ`,
      };
    }

    return {
      success: false,
      points: [],
      error: MATH_ERRORS.PARSE_ERROR,
    };
  }
}

/**
 * Converts grid coordinates to canvas pixel coordinates
 */
export function gridToCanvas(point: Point, gridConfig: GridConfig): Point {
  const { width, height, xMin, xMax, yMin, yMax } = gridConfig;
  
  const canvasX = ((point.x - xMin) / (xMax - xMin)) * width;
  const canvasY = height - ((point.y - yMin) / (yMax - yMin)) * height; // Flip Y axis
  
  return { x: canvasX, y: canvasY };
}

/**
 * Converts canvas pixel coordinates to grid coordinates
 */
export function canvasToGrid(point: Point, gridConfig: GridConfig): Point {
  const { width, height, xMin, xMax, yMin, yMax } = gridConfig;
  
  const gridX = (point.x / width) * (xMax - xMin) + xMin;
  const gridY = ((height - point.y) / height) * (yMax - yMin) + yMin;
  
  return { x: gridX, y: gridY };
}

/**
 * Generates a trajectory path from a player position using the function
 */
export function generateTrajectory(
  functionString: string,
  playerPosition: Point,
  direction: 'left' | 'right',
  gridConfig: GridConfig = DEFAULT_GRID_CONFIG
): ParseResult {
  // Calculate the range based on player position and direction
  // Always use min/max correctly regardless of direction
  const minX = direction === 'right' ? playerPosition.x : gridConfig.xMin;
  const maxX = direction === 'right' ? gridConfig.xMax : playerPosition.x;

  // Parse the function from minX to maxX
  const result = parseMathFunction(functionString, minX, maxX, gridConfig);

  if (!result.success) {
    return result;
  }

  // Offset the trajectory to start from the player's position
  // Find the y value at the player's x position
  let points = result.points;
  
  // For left direction, reverse the points so projectile moves from player toward left
  if (direction === 'left') {
    points = [...points].reverse();
  }

  // Get the first point's y value for offset calculation
  const firstY = points[0]?.y || 0;
  
  // Offset points so trajectory starts from player position
  const offsetPoints = points.map(point => ({
    x: point.x,
    y: point.y - firstY + playerPosition.y,
  }));

  return {
    success: true,
    points: offsetPoints,
  };
}

/**
 * Validates a function string without generating full points
 * Useful for real-time input validation
 */
export function validateFunction(input: string): { valid: boolean; error?: string } {
  if (!input || input.trim() === '') {
    return { valid: false, error: MATH_ERRORS.EMPTY_INPUT };
  }

  const sanitized = sanitizeInput(input);

  try {
    const parsed = math.parse(sanitized);
    const validation = validateAST(parsed);
    
    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }

    // Test evaluation with x = 0
    const compiled = parsed.compile();
    const testResult = compiled.evaluate({ x: 0, e: Math.E, pi: Math.PI });

    if (!isValidNumber(testResult) && typeof testResult !== 'object') {
      return { valid: false, error: MATH_ERRORS.INVALID_RESULT };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: MATH_ERRORS.PARSE_ERROR };
  }
}

/**
 * Get example functions for tutorial/help
 */
export function getExampleFunctions(): Array<{ function: string; description: string }> {
  return [
    { function: 'sin(x)', description: 'Hàm sin' },
    { function: 'cos(x)', description: 'Hàm cos' },
    { function: 'x^2', description: 'Hàm bậc hai (parabol)' },
    { function: '2*x + 1', description: 'Hàm bậc nhất (đường thẳng)' },
    { function: 'sin(x) * x', description: 'Sin nhân x' },
    { function: 'sqrt(abs(x))', description: 'Căn bậc hai của |x|' },
    { function: 'log(x + 1)', description: 'Logarit tự nhiên' },
    { function: 'exp(-x^2)', description: 'Hàm Gaussian' },
    { function: 'tan(x/4)', description: 'Hàm tan' },
    { function: 'abs(sin(x)) * 5', description: 'Sóng sin dương' },
  ];
}
