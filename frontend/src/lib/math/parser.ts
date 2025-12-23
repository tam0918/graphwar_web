/**
 * Math Parser Engine
 * Safely parses and evaluates user-defined mathematical functions
 * Returns Vietnamese error messages for invalid input
 * 
 * Supports 3 modes like original Graphwar:
 * 1. Normal function: y = f(x)
 * 2. First order ODE: y' = f(x, y)
 * 3. Second order ODE: y'' = f(x, y, y')
 */

import { create, all, MathNode, ConstantNode, SymbolNode, FunctionNode, OperatorNode, ParenthesisNode } from 'mathjs';
import { Point, ParseResult, GridConfig, MATH_ERRORS, DEFAULT_GRID_CONFIG, GAME_CONSTANTS, GameMode, CircleObstacle, Terrain } from '@/types';

// Create a mathjs instance with limited scope for security
const math = create(all);

// Allowed functions whitelist for security
const ALLOWED_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'abs', 'log', 'log10', 'log2', 'ln',
  'exp', 'pow', 'floor', 'ceil', 'round',
  'min', 'max', 'sign',
]);

// Allowed operators
const ALLOWED_OPERATORS = new Set([
  '+', '-', '*', '/', '^', 'unaryMinus', 'unaryPlus',
]);

/**
 * Validates the AST to ensure only allowed functions and operators are used
 * @param mode - Game mode to determine allowed variables
 */
function validateAST(node: MathNode, mode: GameMode = 'normal'): { valid: boolean; error?: string } {
  if (node.type === 'ConstantNode') {
    return { valid: true };
  }

  if (node.type === 'SymbolNode') {
    const symbolNode = node as SymbolNode;
    const allowedVars = ['x', 'e', 'pi'];
    
    // For ODE modes, allow y and dy (y')
    if (mode === 'first_order_ode' || mode === 'second_order_ode') {
      allowedVars.push('y');
    }
    if (mode === 'second_order_ode') {
      allowedVars.push('dy'); // y' in second order ODE
    }
    
    if (!allowedVars.includes(symbolNode.name)) {
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
      const result = validateAST(arg, mode);
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
      const result = validateAST(arg, mode);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  if (node.type === 'ParenthesisNode') {
    const parenNode = node as ParenthesisNode;
    return validateAST(parenNode.content, mode);
  }

  return { valid: true };
}

/**
 * Sanitizes the input string before parsing
 * Handles different input formats for various game modes
 */
function sanitizeInput(input: string, mode: GameMode = 'normal'): string {
  let sanitized = input.trim().toLowerCase();
  
  // Remove different prefixes based on mode
  if (mode === 'second_order_ode') {
    // Remove "y''=" prefix
    sanitized = sanitized.replace(/^y\s*''\s*=\s*/, '');
    sanitized = sanitized.replace(/^y\s*''\s*/, '');
  } else if (mode === 'first_order_ode') {
    // Remove "y'=" prefix
    sanitized = sanitized.replace(/^y\s*'\s*=\s*/, '');
    sanitized = sanitized.replace(/^y\s*'\s*/, '');
  } else {
    // Normal mode - remove "y=" or "f(x)=" prefix if present
    sanitized = sanitized.replace(/^y\s*=\s*/, '');
    sanitized = sanitized.replace(/^f\s*\(\s*x\s*\)\s*=\s*/, '');
  }
  
  // Replace y' with dy for ODE modes (mathjs compatible)
  if (mode === 'second_order_ode') {
    sanitized = sanitized.replace(/y'/g, 'dy');
  }
  
  // Replace common alternatives
  sanitized = sanitized.replace(/\*\*/g, '^'); // ** to ^
  sanitized = sanitized.replace(/÷/g, '/');     // Division symbol
  sanitized = sanitized.replace(/×/g, '*');     // Multiplication symbol
  
  // Add implicit multiplication.
  // IMPORTANT: Keep function calls intact (e.g., sin(x), log10(x)) — do NOT turn into sin*(x) or log*10.
  sanitized = sanitized.replace(/(\d)([a-z])/g, '$1*$2');
  // Only variables/constants followed by a number: x2 -> x*2, y3 -> y*3, dy2 -> dy*2, pi2 -> pi*2
  sanitized = sanitized.replace(/\b(x|y|dy|pi|e)(\d+)\b/g, '$1*$2');
  // Close paren followed by value: )( -> )*(, )x -> )*x, )2 -> )*2
  sanitized = sanitized.replace(/\)([a-z\d])/g, ')*$1');
  // Value followed by open paren: 2( -> 2*(, x( -> x*(, dy( -> dy*(
  sanitized = sanitized.replace(/\b(\d+|x|y|dy|pi|e)\(/g, '$1*(');

  // Undo any accidental multiplication inserted between a function name and "("
  // (this is defensive and also covers odd user spacing like "sin * (x)")
  const functionNames = Array.from(ALLOWED_FUNCTIONS).sort((a, b) => b.length - a.length);
  for (const fn of functionNames) {
    const re = new RegExp(`\\b${fn}\\s*\\*\\s*\\(`, 'g');
    sanitized = sanitized.replace(re, `${fn}(`);
  }
  
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
 * Matches original Graphwar logic with three modes:
 * - Normal: y = f(x), translated so function passes through shooter
 * - First Order ODE: y' = f(x, y), using Runge-Kutta 4
 * - Second Order ODE: y'' = f(x, y, y'), using RK4 with firing angle
 */
export function generateTrajectory(
  functionString: string,
  playerPosition: Point,
  direction: 'left' | 'right',
  gridConfig: GridConfig = DEFAULT_GRID_CONFIG,
  mode: GameMode = 'normal',
  firingAngle: number = 0, // Only used for second_order_ode
  terrain?: Terrain // Optional terrain for collision detection
): ParseResult {
  const sanitizedInput = sanitizeInput(functionString, mode);
  let compiled;
  
  try {
    compiled = math.parse(sanitizedInput).compile();
  } catch (e) {
    return { success: false, points: [], error: MATH_ERRORS.PARSE_ERROR };
  }

  const points: Point[] = [];
  const step = GAME_CONSTANTS.STEP_SIZE;
  const maxSteps = GAME_CONSTANTS.FUNC_MAX_STEPS;
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  // Convert player position to game coordinates (matching original)
  // Original uses pixel-based coordinates then converts to game (-25 to 25)
  const inverted = direction === 'left'; // Team 2 (blue) is inverted
  
  // Starting position in game coordinates
  let startX = playerPosition.x;
  let startY = playerPosition.y;
  
  if (inverted) {
    startX = -startX; // Mirror for team 2
  }

  switch (mode) {
    case 'normal':
      return generateNormalTrajectory(compiled, startX, startY, step, maxSteps, inverted, gridConfig, terrain);
    
    case 'first_order_ode':
      return generateODE1Trajectory(compiled, startX, startY, step, maxSteps, inverted, gridConfig, terrain);
    
    case 'second_order_ode':
      return generateODE2Trajectory(compiled, startX, startY, firingAngle, step, maxSteps, inverted, gridConfig, terrain);
    
    default:
      return { success: false, points: [], error: MATH_ERRORS.PARSE_ERROR };
  }
}

/**
 * Generate trajectory for normal function mode y = f(x)
 * Function is translated so it passes through the shooter's position
 */
function generateNormalTrajectory(
  compiled: any,
  startX: number,
  startY: number,
  step: number,
  maxSteps: number,
  inverted: boolean,
  gridConfig: GridConfig,
  terrain?: Terrain
): ParseResult {
  const points: Point[] = [];
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  // Calculate offset so function passes through shooter
  // offset = startY - f(startX)
  let offset: number;
  try {
    const f0 = compiled.evaluate({ x: startX, e: Math.E, pi: Math.PI });
    if (!isValidNumber(f0)) {
      return { success: false, points: [], error: MATH_ERRORS.INVALID_RESULT };
    }
    offset = startY - f0;
  } catch {
    return { success: false, points: [], error: MATH_ERRORS.INVALID_RESULT };
  }

  let x = startX;
  
  for (let i = 0; i < maxSteps; i++) {
    try {
      const y = compiled.evaluate({ x, e: Math.E, pi: Math.PI }) + offset;
      
      if (!isValidNumber(y)) {
        break;
      }
      
      // Convert back to world coordinates
      const worldX = inverted ? -x : x;
      const worldY = y;
      
      // Check bounds
      if (worldX < xMin || worldX > xMax || worldY < yMin || worldY > yMax) {
        // Add the last point at boundary
        points.push({ x: worldX, y: Math.max(yMin, Math.min(yMax, worldY)) });
        break;
      }
      
      // Check terrain collision
      if (terrain && checkTerrainCollision(worldX, worldY, terrain, gridConfig)) {
        points.push({ x: worldX, y: worldY });
        break;
      }
      
      points.push({ x: worldX, y: worldY });
      
      // Move forward
      x += step;
    } catch {
      break;
    }
  }
  
  if (points.length === 0) {
    return { success: false, points: [], error: MATH_ERRORS.INVALID_RESULT };
  }
  
  return { success: true, points };
}

/**
 * Generate trajectory for first order ODE: y' = f(x, y)
 * Uses Runge-Kutta 4 method
 */
function generateODE1Trajectory(
  compiled: any,
  startX: number,
  startY: number,
  step: number,
  maxSteps: number,
  inverted: boolean,
  gridConfig: GridConfig,
  terrain?: Terrain
): ParseResult {
  const points: Point[] = [];
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  let x = startX;
  let y = startY;
  
  for (let i = 0; i < maxSteps; i++) {
    // Convert to world coordinates
    const worldX = inverted ? -x : x;
    const worldY = y;
    
    // Check bounds
    if (worldX < xMin || worldX > xMax || worldY < yMin || worldY > yMax) {
      points.push({ x: worldX, y: Math.max(yMin, Math.min(yMax, worldY)) });
      break;
    }
    
    // Check terrain collision
    if (terrain && checkTerrainCollision(worldX, worldY, terrain, gridConfig)) {
      points.push({ x: worldX, y: worldY });
      break;
    }
    
    points.push({ x: worldX, y: worldY });
    
    // Runge-Kutta 4 integration
    try {
      const k1 = compiled.evaluate({ x, y, e: Math.E, pi: Math.PI });
      const k2 = compiled.evaluate({ x: x + step/2, y: y + step*k1/2, e: Math.E, pi: Math.PI });
      const k3 = compiled.evaluate({ x: x + step/2, y: y + step*k2/2, e: Math.E, pi: Math.PI });
      const k4 = compiled.evaluate({ x: x + step, y: y + step*k3, e: Math.E, pi: Math.PI });
      
      if (!isValidNumber(k1) || !isValidNumber(k2) || !isValidNumber(k3) || !isValidNumber(k4)) {
        break;
      }
      
      y = y + (step/6) * (k1 + 2*k2 + 2*k3 + k4);
      x = x + step;
    } catch {
      break;
    }
  }
  
  if (points.length === 0) {
    return { success: false, points: [], error: MATH_ERRORS.INVALID_RESULT };
  }
  
  return { success: true, points };
}

/**
 * Generate trajectory for second order ODE: y'' = f(x, y, y')
 * Uses Runge-Kutta 4 method with firing angle as initial y'
 */
function generateODE2Trajectory(
  compiled: any,
  startX: number,
  startY: number,
  firingAngle: number,
  step: number,
  maxSteps: number,
  inverted: boolean,
  gridConfig: GridConfig,
  terrain?: Terrain
): ParseResult {
  const points: Point[] = [];
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  let x = startX;
  let y = startY;
  let dy = Math.tan(firingAngle); // Initial derivative from firing angle
  
  for (let i = 0; i < maxSteps; i++) {
    // Convert to world coordinates
    const worldX = inverted ? -x : x;
    const worldY = y;
    
    // Check bounds
    if (worldX < xMin || worldX > xMax || worldY < yMin || worldY > yMax) {
      points.push({ x: worldX, y: Math.max(yMin, Math.min(yMax, worldY)) });
      break;
    }
    
    // Check terrain collision
    if (terrain && checkTerrainCollision(worldX, worldY, terrain, gridConfig)) {
      points.push({ x: worldX, y: worldY });
      break;
    }
    
    points.push({ x: worldX, y: worldY });
    
    // Runge-Kutta 4 for second order ODE (converted to system of first order)
    // Let y1 = y, y2 = y'
    // y1' = y2
    // y2' = f(x, y1, y2)
    try {
      const k11 = dy;
      const k12 = compiled.evaluate({ x, y, dy, e: Math.E, pi: Math.PI });
      
      const k21 = dy + step*k12/2;
      const k22 = compiled.evaluate({ 
        x: x + step/2, 
        y: y + step*k11/2, 
        dy: dy + step*k12/2,
        e: Math.E, pi: Math.PI 
      });
      
      const k31 = dy + step*k22/2;
      const k32 = compiled.evaluate({ 
        x: x + step/2, 
        y: y + step*k21/2, 
        dy: dy + step*k22/2,
        e: Math.E, pi: Math.PI 
      });
      
      const k41 = dy + step*k32;
      const k42 = compiled.evaluate({ 
        x: x + step, 
        y: y + step*k31, 
        dy: dy + step*k32,
        e: Math.E, pi: Math.PI 
      });
      
      if (!isValidNumber(k12) || !isValidNumber(k22) || !isValidNumber(k32) || !isValidNumber(k42)) {
        break;
      }
      
      y = y + (step/6) * (k11 + 2*k21 + 2*k31 + k41);
      dy = dy + (step/6) * (k12 + 2*k22 + 2*k32 + k42);
      x = x + step;
    } catch {
      break;
    }
  }
  
  if (points.length === 0) {
    return { success: false, points: [], error: MATH_ERRORS.INVALID_RESULT };
  }
  
  return { success: true, points };
}

/**
 * Check if a point collides with terrain circles
 */
function checkTerrainCollision(
  x: number, 
  y: number, 
  terrain: Terrain,
  gridConfig: GridConfig
): boolean {
  for (const circle of terrain.circles) {
    const dx = x - circle.x;
    const dy = y - circle.y;
    const distSquared = dx * dx + dy * dy;
    if (distSquared <= circle.radius * circle.radius) {
      return true;
    }
  }
  
  // Check explosion holes too
  for (const exp of terrain.explosions) {
    const dx = x - exp.x;
    const dy = y - exp.y;
    const distSquared = dx * dx + dy * dy;
    if (distSquared <= exp.radius * exp.radius) {
      return true;
    }
  }
  
  return false;
}

/**
 * Validates a function string without generating full points
 * Useful for real-time input validation
 */
export function validateFunction(input: string, mode: GameMode = 'normal'): { valid: boolean; error?: string } {
  if (!input || input.trim() === '') {
    return { valid: false, error: MATH_ERRORS.EMPTY_INPUT };
  }

  const sanitized = sanitizeInput(input, mode);

  try {
    const parsed = math.parse(sanitized);
    const validation = validateAST(parsed, mode);
    
    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }

    // Test evaluation with appropriate variables
    const compiled = parsed.compile();
    const scope: Record<string, number> = { x: 0, e: Math.E, pi: Math.PI };
    
    if (mode === 'first_order_ode' || mode === 'second_order_ode') {
      scope.y = 0;
    }
    if (mode === 'second_order_ode') {
      scope.dy = 0;
    }
    
    const testResult = compiled.evaluate(scope);

    if (!isValidNumber(testResult) && typeof testResult !== 'object') {
      return { valid: false, error: MATH_ERRORS.INVALID_RESULT };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: MATH_ERRORS.PARSE_ERROR };
  }
}

/**
 * Get example functions for tutorial/help based on game mode
 */
export function getExampleFunctions(mode: GameMode = 'normal'): Array<{ function: string; description: string }> {
  switch (mode) {
    case 'normal':
      return [
        { function: 'sin(x)', description: 'Hàm sin - sóng nhẹ' },
        { function: 'cos(x)', description: 'Hàm cos' },
        { function: 'x^2/20', description: 'Parabol - đường cong lên' },
        { function: '-x^2/20', description: 'Parabol ngược - đường cong xuống' },
        { function: '2*x + 1', description: 'Đường thẳng nghiêng lên' },
        { function: 'sin(x/5)*3', description: 'Sóng sin lớn' },
        { function: 'sqrt(abs(x))', description: 'Căn bậc hai' },
        { function: 'ln(abs(x))', description: 'Logarit tự nhiên' },
        { function: 'exp(-x^2/10)', description: 'Hàm Gaussian' },
        { function: 'tan(x/10)', description: 'Hàm tan - dốc đứng' },
      ];
    
    case 'first_order_ode':
      return [
        { function: '3*sin(x)+2', description: "y' = 3sin(x)+2" },
        { function: '-y/3', description: "y' = -y/3 - suy giảm" },
        { function: '1/(x+y+1)', description: "y' = 1/(x+y+1)" },
        { function: 'y', description: "y' = y - tăng mũ" },
        { function: '-y + x', description: "y' = -y + x" },
        { function: 'cos(x) - y/2', description: "y' = cos(x) - y/2" },
        { function: 'sin(y)', description: "y' = sin(y)" },
        { function: 'x*y', description: "y' = xy" },
      ];
    
    case 'second_order_ode':
      return [
        { function: '-y', description: "y'' = -y - dao động điều hòa" },
        { function: '-y + dy', description: "y'' = -y + y' - dao động tắt dần" },
        { function: '4*sin(x)', description: "y'' = 4sin(x)" },
        { function: '-9.8', description: "y'' = -9.8 - trọng lực" },
        { function: '-y - dy/4', description: "y'' = -y - y'/4 - tắt dần" },
        { function: 'cos(x) - y', description: "y'' = cos(x) - y" },
        { function: '1.04^(-(x+y)^2) * 20', description: 'Phức tạp - thử nghiệm!' },
      ];
    
    default:
      return [];
  }
}

/**
 * Generate random terrain with circular obstacles (matching original Graphwar)
 */
export function generateTerrain(gridConfig: GridConfig = DEFAULT_GRID_CONFIG): Terrain {
  const { xMin, xMax, yMin, yMax } = gridConfig;
  const circles: CircleObstacle[] = [];
  
  // Random number of circles based on Gaussian distribution
  const numCircles = Math.max(1, Math.round(
    randomGaussian(GAME_CONSTANTS.NUM_CIRCLES_MEAN, GAME_CONSTANTS.NUM_CIRCLES_STD_DEV)
  ));
  
  for (let i = 0; i < numCircles; i++) {
    // Random position within game bounds
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    
    // Random radius based on Gaussian distribution
    let radius = randomGaussian(GAME_CONSTANTS.CIRCLE_MEAN_RADIUS, GAME_CONSTANTS.CIRCLE_STD_DEV);
    radius = Math.max(0.5, radius); // Minimum radius
    
    circles.push({ x, y, radius });
  }
  
  return {
    circles,
    explosions: [],
  };
}

/**
 * Generate random number with Gaussian distribution
 */
function randomGaussian(mean: number, stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}
