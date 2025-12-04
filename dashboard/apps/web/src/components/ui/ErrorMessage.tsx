import React from 'react';
import './ErrorMessage.css';

interface ErrorMessageProps {
  error: string | Error;
  details?: string;
  className?: string;
  onRetry?: () => void;
}

export function ErrorMessage({
  error,
  details,
  className = '',
  onRetry
}: ErrorMessageProps) {
  const message = error instanceof Error ? error.message : error;
  
  return (
    <div className={`error-message ${className}`}>
      <div className="error-message__icon">⚠️</div>
      <div className="error-message__content">
        <div className="error-message__title">{message}</div>
        {details && (
          <div className="error-message__details">{details}</div>
        )}
        {onRetry && (
          <button
            className="error-message__retry"
            onClick={onRetry}
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}