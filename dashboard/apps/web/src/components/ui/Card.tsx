import React from 'react';
import './Card.css';

type CardVariant = 'default' | 'elevated';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: CardVariant;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Card(props: CardProps) {
  const {
    children,
    className = '',
    variant = 'default',
    header,
    footer,
    actions,
    ...rest
  } = props;
  return (
    <div className={`card card--${variant} ${className}`} {...rest}>
      {header && (
        <div className="card__header">
          {header}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      <div className="card__content">{children}</div>
      {footer && <div className="card__footer">{footer}</div>}
    </div>
  );
}