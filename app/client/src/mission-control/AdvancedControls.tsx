import type { ReactNode } from "react";

export function AdvancedControls(props: {
  children: ReactNode;
  manualPaused: boolean;
  backLabel?: string;
  onBack: () => void;
  onPause: () => void;
}) {
  return <main className="mc-root mc-advanced-root" aria-label="Sarathi advanced controls">
    <a className="mc-skip" href="#mc-advanced-work">Skip to advanced controls</a>
    <header className="mc-header">
      <div className="mc-brand"><span className="mc-brand-mark" aria-hidden="true">✳</span><span>Sarathi</span><span className="mc-header-divider" aria-hidden="true" /><span className="mc-header-context">Advanced settings</span></div>
      <div className="mc-header-actions">
        <button type="button" className="mc-tool" onClick={props.onBack}>{props.backLabel ?? "Back to Mission Control"}</button>
        <button type="button" className="mc-tool" onClick={props.onPause}>{props.manualPaused ? "Resume dispatch" : "Pause dispatch"}</button>
      </div>
    </header>
    <div className="mc-advanced-layout">
      <nav className="mc-advanced-nav" aria-label="Advanced settings sections">
        <a href="#mc-advanced-work">Work items</a>
        <a href="#mc-advanced-agents">Agents and tasks</a>
        <a href="#mc-advanced-runtime">Runtime and providers</a>
        <a href="#mc-advanced-routing">Routing and consent</a>
      </nav>
      <div className="mc-advanced-content">
        <div className="mc-advanced-intro">
          <p className="mc-eyebrow">Secondary controls</p>
          <h1>Advanced controls</h1>
          <p>Work administration, agent execution and runtime configuration.</p>
        </div>
        {props.children}
      </div>
    </div>
  </main>;
}
