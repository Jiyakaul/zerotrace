import React from 'react';
import { LuMenu, LuMoon, LuSun, LuChevronRight } from 'react-icons/lu';
import { IconButton } from '../ui/Primitives';

export default function TopBar({ title, description, breadcrumb = [], actions, theme, onToggleTheme, onOpenNav }) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <button type="button" className="topbar__menu" onClick={onOpenNav} aria-label="Open navigation">
          <LuMenu aria-hidden="true" />
        </button>

        <div className="topbar__heading">
          {breadcrumb.length > 0 && (
            <nav className="crumbs" aria-label="Breadcrumb">
              {breadcrumb.map((crumb, i) => (
                <React.Fragment key={crumb.label}>
                  {i > 0 && <LuChevronRight className="crumbs__sep" aria-hidden="true" />}
                  {crumb.onClick ? (
                    <button type="button" className="crumbs__link" onClick={crumb.onClick}>
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="crumbs__current">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          )}
          <h1 className="topbar__title">{title}</h1>
          {description && <p className="topbar__desc">{description}</p>}
        </div>

        <div className="topbar__actions">
          {actions}
          <IconButton
            icon={theme === 'dark' ? LuSun : LuMoon}
            label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={onToggleTheme}
            variant="outline"
          />
        </div>
      </div>
    </header>
  );
}
