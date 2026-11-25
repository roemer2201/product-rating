import type { ReactNode } from 'react';
import { Brand } from '@/components/Brand';
import { strings } from '@/lib/strings';

interface AuthLayoutProps {
  title: string;
  intro: string;
  children: ReactNode;
}

export function AuthLayout({ title, intro, children }: AuthLayoutProps) {
  return (
    <div className="auth-layout">
      <header className="brand-bar">
        <Brand />
      </header>
      <main className="auth-main">
        <div className="auth-cover">
          <div className="auth-cover__photo" />
          <p>{strings.app.tagline}</p>
        </div>
        <div className="auth-card">
          <h1 className="auth-card__title">{title}</h1>
          <p className="auth-card__intro">{intro}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
