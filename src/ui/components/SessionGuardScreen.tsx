'use client';

import { ar } from '../copy/ar';

/**
 * شاشة «يجري التحقق من الجلسة» بهيكل بصري شبيه بالتطبيق.
 * لا تعرض أي بيانات ساحة وهي اهتزاز (skeleton) بصري فقط — نفس سياسة الأمان:
 * لا يبدأ المحتوى الحقيقي قبل أن يتحقق الخادم من صلاحية الجلسة.
 */
export function SessionGuardScreen() {
  return (
    <div className="session-guard">
      <header className="session-guard__header" aria-hidden="true">
        <span className="sk sk--logo" />
        <span className="session-guard__header-pills">
          <span className="sk sk--pill" />
          <span className="sk sk--pill" />
        </span>
      </header>
      <aside className="session-guard__side" aria-hidden="true">
        <span className="sk sk--line" />
        <span className="sk sk--line" />
        <span className="sk sk--line" />
        <span className="sk sk--line" />
        <span className="sk sk--line" />
      </aside>
      <main className="session-guard__main">
        <section className="state-panel" role="status">
          <h1 className="state-panel__title">{ar.state.sessionCheckingTitle}</h1>
          <p className="state-panel__description">{ar.state.sessionCheckingDescription}</p>
        </section>
        <div className="session-guard__cards" aria-hidden="true">
          <span className="sk sk--card" />
          <span className="sk sk--card" />
          <span className="sk sk--card" />
          <span className="sk sk--card" />
        </div>
      </main>
      <nav className="session-guard__nav" aria-hidden="true">
        <span className="sk sk--tab" />
        <span className="sk sk--tab" />
        <span className="sk sk--tab" />
        <span className="sk sk--tab" />
        <span className="sk sk--tab" />
        <span className="sk sk--tab" />
      </nav>
    </div>
  );
}
