'use client';

/**
 * ControlPanel Component
 * User interface for function input and game controls
 * All labels and text in Vietnamese
 */

import React, { useState, useCallback, useEffect } from 'react';
import { UI_TEXT, MATH_ERRORS } from '@/types';
import { validateFunction, getExampleFunctions } from '@/lib/math';

interface ControlPanelProps {
  isMyTurn: boolean;
  isGameActive: boolean;
  currentPhase: string;
  onFire: (functionString: string) => void;
  onReady?: () => void;
  playerName?: string;
  opponentName?: string;
  disabled?: boolean;
}

export function ControlPanel({
  isMyTurn,
  isGameActive,
  currentPhase,
  onFire,
  onReady,
  playerName = 'Người chơi',
  opponentName = 'Đối thủ',
  disabled = false,
}: ControlPanelProps) {
  const [functionInput, setFunctionInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  // Validate input in real-time
  useEffect(() => {
    if (!functionInput.trim()) {
      setValidationError(null);
      return;
    }

    const result = validateFunction(functionInput);
    setValidationError(result.valid ? null : result.error || MATH_ERRORS.PARSE_ERROR);
  }, [functionInput]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!functionInput.trim()) {
      setValidationError(MATH_ERRORS.EMPTY_INPUT);
      return;
    }

    const result = validateFunction(functionInput);
    if (!result.valid) {
      setValidationError(result.error || MATH_ERRORS.PARSE_ERROR);
      return;
    }

    onFire(functionInput);
    setFunctionInput('');
    setValidationError(null);
  }, [functionInput, onFire]);

  const handleExampleClick = useCallback((example: string) => {
    setFunctionInput(example);
    setShowExamples(false);
  }, []);

  const examples = getExampleFunctions();

  // Get phase display text
  const getPhaseText = (phase: string): string => {
    const phaseMap: Record<string, string> = {
      waiting: UI_TEXT.PHASE_WAITING,
      ready: UI_TEXT.PHASE_READY,
      input: UI_TEXT.PHASE_INPUT,
      firing: UI_TEXT.PHASE_FIRING,
      animating: UI_TEXT.PHASE_ANIMATING,
      hit: UI_TEXT.PHASE_HIT,
      miss: UI_TEXT.PHASE_MISS,
      gameover: UI_TEXT.PHASE_GAMEOVER,
    };
    return phaseMap[phase] || phase;
  };

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-gray-700">
      {/* Turn Indicator */}
      <div className="mb-6">
        <div className={`
          text-center py-3 px-4 rounded-lg font-bold text-lg
          bg-green-600/20 text-green-400 border border-green-500/50
        `}>
          <span className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Lượt của: {playerName}
          </span>
        </div>
      </div>

      {/* Phase Status */}
      <div className="mb-4 text-center">
        <span className="text-sm text-gray-400">Trạng thái: </span>
        <span className="text-sm font-medium text-indigo-400">
          {getPhaseText(currentPhase)}
        </span>
      </div>

      {/* Function Input Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Hàm số y = f(x)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={functionInput}
              onChange={(e) => setFunctionInput(e.target.value)}
              placeholder={UI_TEXT.INPUT_PLACEHOLDER}
              disabled={!isMyTurn || !isGameActive || disabled}
              className={`
                flex-1 px-4 py-3 bg-gray-800 border rounded-lg
                text-white placeholder-gray-500 font-mono
                focus:outline-none focus:ring-2 focus:ring-indigo-500
                disabled:opacity-50 disabled:cursor-not-allowed
                ${validationError 
                  ? 'border-red-500 focus:ring-red-500' 
                  : 'border-gray-600'
                }
              `}
            />
            <button
              type="submit"
              disabled={!isMyTurn || !isGameActive || disabled || !!validationError}
              className={`
                px-6 py-3 rounded-lg font-bold text-white
                transition-all duration-200
                ${isMyTurn && isGameActive && !disabled && !validationError
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 shadow-lg hover:shadow-orange-500/25'
                  : 'bg-gray-700 cursor-not-allowed'
                }
              `}
            >
              🎯 {UI_TEXT.BTN_FIRE}
            </button>
          </div>

          {/* Validation Error */}
          {validationError && (
            <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
              <span>⚠️</span> {validationError}
            </p>
          )}

          {/* Input Hint */}
          <p className="mt-2 text-xs text-gray-500">
            {UI_TEXT.INPUT_EXAMPLE}
          </p>
        </div>

        {/* Examples Toggle */}
        <button
          type="button"
          onClick={() => setShowExamples(!showExamples)}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {showExamples ? '▼' : '▶'} Xem hàm mẫu
        </button>

        {/* Examples List */}
        {showExamples && (
          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-400 mb-3">Chọn một hàm mẫu:</p>
            <div className="grid grid-cols-2 gap-2">
              {examples.map((example, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleExampleClick(example.function)}
                  className="
                    text-left px-3 py-2 bg-gray-700/50 rounded
                    hover:bg-gray-600/50 transition-colors
                    text-sm
                  "
                >
                  <span className="font-mono text-yellow-400">{example.function}</span>
                  <span className="block text-xs text-gray-400 mt-1">{example.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Help Section */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-xs text-gray-500">
          💡 <strong>Mẹo:</strong> {UI_TEXT.TOOLTIP_FUNCTION_HELP}
        </p>
      </div>
    </div>
  );
}

export default ControlPanel;
