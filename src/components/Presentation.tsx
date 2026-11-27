import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  Check,
  Download,
  FileText,
  Layers,
  Loader2,
  MapPin,
  Receipt,
  Search,
  Sparkles,
  Users,
  WifiOff,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import type { Entreprise } from '@/types';
import {
  getPresentationModules,
  getRoleMatrix,
  getTechnicalSpecs,
  getUserGuideChapters,
  getWorkflowSteps,
} from '@/lib/userGuideContent';
import {
  downloadPresentationPdf,
  downloadUserGuidePdf,
} from '@/lib/generateUserGuidePdf';

type ActiveTab = 'presentation' | 'guide';

function ModuleIcon({ id }: { id: string }) {
  const cls = 'w-4 h-4 text-sky-600 shrink-0';
  switch (id) {
    case 'depot':
      return <Receipt className={cls} />;
    case 'retrait':
      return <Layers className={cls} />;
    case 'commerciaux':
      return <Briefcase className={cls} />;
    case 'logistique':
      return <MapPin className={cls} />;
    case 'clients':
      return <Users className={cls} />;
    case 'finances':
      return <Calculator className={cls} />;
    case 'equipe':
      return <Building2 className={cls} />;
    case 'offline':
      return <WifiOff className={cls} />;
    default:
      return <Sparkles className={cls} />;
  }
}

export default function Presentation() {
  const { lang } = useI18n();
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('presentation');
  const [guideSearch, setGuideSearch] = useState('');
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [exportingType, setExportingType] = useState<'guide' | 'presentation' | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  useEffect(() => {
    db.getEntreprise().then(setEntreprise).catch(() => {});
  }, []);

  const companyName = entreprise?.nom?.trim() || 'PressingLite';

  const modules = useMemo(() => getPresentationModules(lang), [lang]);
  const steps = useMemo(() => getWorkflowSteps(lang), [lang]);
  const roleMatrix = useMemo(() => getRoleMatrix(lang), [lang]);
  const specs = useMemo(() => getTechnicalSpecs(lang), [lang]);
  const chapters = useMemo(() => getUserGuideChapters(lang), [lang]);

  useEffect(() => {
    if (chapters.length > 0 && !chapters.some((c) => c.id === activeChapterId)) {
      setActiveChapterId(chapters[0].id);
    }
  }, [chapters, activeChapterId]);

  const filteredChapters = useMemo(() => {
    const q = guideSearch.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((ch) => {
      if (
        ch.title.toLowerCase().includes(q) ||
        ch.subtitle.toLowerCase().includes(q) ||
        ch.summary.toLowerCase().includes(q)
      ) {
        return true;
      }
      return ch.sections.some(
        (s) =>
          s.heading.toLowerCase().includes(q) ||
          (s.intro && s.intro.toLowerCase().includes(q)) ||
          (s.tip && s.tip.toLowerCase().includes(q)) ||
          (s.steps && s.steps.some((st) => st.toLowerCase().includes(q))) ||
          (s.bullets && s.bullets.some((b) => b.toLowerCase().includes(q))),
      );
    });
  }, [chapters, guideSearch]);

  function handleDownloadGuidePdf() {
    if (exportingType) return;
    setExportingType('guide');
    setExportNotice(null);
    setTimeout(() => {
      try {
        downloadUserGuidePdf(entreprise, lang);
        setExportNotice(
          lang === 'fr'
            ? 'Le guide d\'utilisation complet (PDF) a été téléchargé.'
            : 'The complete User Guide PDF has been downloaded.',
        );
      } finally {
        setExportingType(null);
      }
    }, 40);
  }

  function handleDownloadPresentationPdf() {
    if (exportingType) return;
    setExportingType('presentation');
    setExportNotice(null);
    setTimeout(() => {
      try {
        downloadPresentationPdf(entreprise, lang);
        setExportNotice(
          lang === 'fr'
            ? 'La brochure de présentation (PDF) a été téléchargée.'
            : 'The Software Presentation PDF has been downloaded.',
        );
      } finally {
        setExportingType(null);
      }
    }, 40);
  }

  function scrollToChapter(id: string) {
    setActiveChapterId(id);
    const el = document.getElementById(`guide-chapter-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-10">
      {/* Top workspace toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('presentation')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'presentation'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            {lang === 'fr' ? 'Présentation du logiciel' : 'Software overview'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'guide'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            {lang === 'fr'
              ? `Guide d'utilisation (${chapters.length})`
              : `User guide (${chapters.length})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadPresentationPdf}
            disabled={exportingType !== null}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {exportingType === 'presentation' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {lang === 'fr' ? 'Présentation (PDF)' : 'Overview (PDF)'}
          </button>
          <button
            type="button"
            onClick={handleDownloadGuidePdf}
            disabled={exportingType !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {exportingType === 'guide' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {lang === 'fr'
              ? "Télécharger le guide d'utilisation (PDF)"
              : 'Download User Guide (PDF)'}
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 flex items-center justify-between gap-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{exportNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap"
          >
            {lang === 'fr' ? 'Fermer' : 'Dismiss'}
          </button>
        </div>
      )}

      {activeTab === 'presentation' ? (
        <div className="space-y-10">
          {/* Hero split */}
          <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 lg:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-sky-700">
                    {lang === 'fr'
                      ? 'Gestion de pressing & blanchisserie · En ligne & hors-ligne (PWA)'
                      : 'Dry cleaning & laundry management · Online & offline PWA'}
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-tight [text-wrap:balance]">
                    {companyName}
                  </h1>
                  <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                    {lang === 'fr'
                      ? "Une plateforme complète pour piloter chaque étape de votre pressing : accueil comptoir ultra-rapide, retraits, commerciaux et commissions, portails client et commercial, tournées Google Maps, comptabilité et continuité hors-ligne."
                      : 'A complete platform to run every stage of your dry cleaning business: fast counter intake, pickups, sales agents and commissions, client and commercial portals, Google Maps runs, accounting, and offline continuity.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                  <div>
                    <p className="text-xl font-bold text-slate-900 tabular-nums">8</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'fr' ? 'Modules métiers intégrés' : 'Integrated modules'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-slate-900 tabular-nums">4 000+</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'fr' ? 'Clients recherchés en < 1 ms' : 'Clients searched in < 1 ms'}
                    </p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-xl font-bold text-slate-900 tabular-nums">100 %</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === 'fr' ? 'Opérationnel hors-ligne' : 'Offline-ready PWA'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleDownloadGuidePdf}
                    disabled={exportingType !== null}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    {lang === 'fr' ? "Guide d'utilisation (PDF)" : 'User Guide (PDF)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('guide')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <BookOpen className="w-4 h-4" />
                    {lang === 'fr' ? 'Consulter le manuel ici' : 'Read guide here'}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6 flex">
                {!heroImgFailed ? (
                  <div className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">
                    <img
                      src="/hero-presentation.webp"
                      alt={
                        lang === 'fr'
                          ? `Aperçu de l'interface ${companyName}`
                          : `${companyName} workspace preview`
                      }
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-8 flex flex-col justify-center items-center text-center space-y-2">
                    <Layers className="w-8 h-8 text-sky-600" />
                    <p className="text-sm font-semibold text-slate-800">{companyName}</p>
                    <p className="text-xs text-slate-500">
                      {lang === 'fr'
                        ? 'Tableau de bord, Dépôts, Retraits, Commerciaux & Comptabilité'
                        : 'Dashboard, Deposits, Pickups, Sales Agents & Accounting'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 8 Core Modules */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  {lang === 'fr'
                    ? 'Fonctionnalités complètes du logiciel'
                    : 'Complete software capabilities'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {lang === 'fr'
                    ? 'Tous les modules disponibles aujourd\'hui dans votre espace de gestion.'
                    : 'Every module currently available in your workspace.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modules.map((mod, idx) => (
                <article
                  key={mod.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-2 font-medium text-slate-600">
                        <ModuleIcon id={mod.id} />
                        {mod.category}
                      </span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900">{mod.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{mod.summary}</p>
                  </div>

                  <ul className="space-y-1.5 pt-3 border-t border-slate-100">
                    {mod.highlights.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-xs sm:text-[13px] text-slate-600 leading-snug"
                      >
                        <Check className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          {/* Operational Workflow */}
          <section className="space-y-4">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {lang === 'fr' ? 'Parcours opérationnel au quotidien' : 'Daily operational workflow'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {steps.map((step) => (
                <div
                  key={step.num}
                  className="bg-white rounded-xl border border-slate-200 p-5 space-y-2.5"
                >
                  <p className="font-mono text-sm font-bold text-sky-600 tabular-nums">
                    {step.num}.
                  </p>
                  <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Roles Matrix */}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'fr' ? 'Organisation d\'équipe & rôles' : 'Team roles & permissions'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {lang === 'fr'
                  ? 'Chaque collaborateur dispose d\'un accès adapté à son poste avec traçabilité sur les reçus.'
                  : 'Each team member gets role-appropriate permissions with receipt-level accountability.'}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                    <th className="py-3 px-6 whitespace-nowrap">
                      {lang === 'fr' ? 'Rôle' : 'Role'}
                    </th>
                    <th className="py-3 px-4 whitespace-nowrap">
                      {lang === 'fr' ? 'Périmètre' : 'Scope'}
                    </th>
                    <th className="py-3 px-6">
                      {lang === 'fr' ? 'Actions principales' : 'Key responsibilities'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roleMatrix.map((row) => (
                    <tr key={row.role} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-6 font-semibold text-slate-900 whitespace-nowrap">
                        {row.role}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                        {row.scope}
                      </td>
                      <td className="py-3.5 px-6 text-slate-600 leading-relaxed">
                        {row.keyActions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Technical Specifications */}
          <section className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {lang === 'fr' ? 'Caractéristiques techniques' : 'Technical specifications'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {lang === 'fr'
                  ? 'Architecture cloud sécurisée conçue pour les exigences de caisse en pressing.'
                  : 'Secure cloud-and-offline architecture built for front-desk reliability.'}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
              {specs.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-4 py-2.5 border-b border-slate-100"
                >
                  <span className="text-xs sm:text-sm text-slate-500 shrink-0">{label}</span>
                  <span className="text-xs sm:text-sm font-medium text-slate-900 text-right">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* ─── TAB 2: Interactive User Guide + 1-Click PDF Export ─── */
        <div className="space-y-6">
          {/* PDF export summary bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {lang === 'fr'
                  ? `${chapters.length} chapitres · Format A4 illustré avec sommaire paginé`
                  : `${chapters.length} chapters · Printable A4 manual with table of contents`}
              </p>
              <h1 className="text-xl font-bold text-slate-900">
                {lang === 'fr'
                  ? `Guide d'utilisation — ${companyName}`
                  : `User Guide — ${companyName}`}
              </h1>
              <p className="text-sm text-slate-600">
                {lang === 'fr'
                  ? 'Consultez les procédures pas à pas ci-dessous ou téléchargez la version PDF prête à imprimer et à partager avec votre équipe.'
                  : 'Browse step-by-step procedures below or download the print-ready PDF version to share with your team.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadGuidePdf}
              disabled={exportingType !== null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {exportingType === 'guide' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {lang === 'fr' ? 'Télécharger le PDF complet' : 'Download full PDF'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left sticky TOC + Search */}
            <aside className="lg:col-span-4 xl:col-span-3 lg:sticky lg:top-6 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={guideSearch}
                  onChange={(e) => setGuideSearch(e.target.value)}
                  placeholder={
                    lang === 'fr'
                      ? 'Rechercher dans le guide…'
                      : 'Search the user guide…'
                  }
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <nav
                aria-label={lang === 'fr' ? 'Chapitres du guide' : 'Guide chapters'}
                className="bg-white rounded-xl border border-slate-200 p-2 space-y-0.5"
              >
                {filteredChapters.map((ch) => {
                  const isActive = activeChapterId === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => scrollToChapter(ch.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors flex items-baseline gap-2.5 ${
                        isActive
                          ? 'bg-sky-50 text-sky-900 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <span className="font-mono text-xs text-sky-600 tabular-nums shrink-0">
                        {ch.number}
                      </span>
                      <span className="truncate">{ch.title}</span>
                    </button>
                  );
                })}
                {filteredChapters.length === 0 && (
                  <p className="px-3 py-4 text-xs text-slate-400 text-center">
                    {lang === 'fr' ? 'Aucun chapitre trouvé.' : 'No matching chapters.'}
                  </p>
                )}
              </nav>
            </aside>

            {/* Right chapters body */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-5">
              {filteredChapters.map((chapter) => (
                <article
                  key={chapter.id}
                  id={`guide-chapter-${chapter.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 space-y-5 scroll-mt-6"
                >
                  <header className="space-y-1.5 border-b border-slate-100 pb-4">
                    <p className="text-xs font-mono font-semibold text-sky-600 tabular-nums">
                      {lang === 'fr'
                        ? `Chapitre ${chapter.number}`
                        : `Chapter ${chapter.number}`}
                    </p>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                      {chapter.title}
                    </h2>
                    <p className="text-sm text-slate-500">{chapter.subtitle}</p>
                    <p className="text-sm text-slate-700 leading-relaxed pt-1">
                      {chapter.summary}
                    </p>
                  </header>

                  <div className="space-y-5">
                    {chapter.sections.map((section) => (
                      <div key={section.heading} className="space-y-2.5">
                        <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                          {section.heading}
                        </h3>
                        {section.intro && (
                          <p className="text-sm text-slate-600 leading-relaxed">
                            {section.intro}
                          </p>
                        )}
                        {section.steps && section.steps.length > 0 && (
                          <ol className="space-y-2">
                            {section.steps.map((stepText, idx) => (
                              <li
                                key={stepText}
                                className="flex items-start gap-3 text-sm text-slate-700 leading-relaxed"
                              >
                                <span className="w-5 h-5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                                  {idx + 1}
                                </span>
                                <span>{stepText}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {section.bullets && section.bullets.length > 0 && (
                          <ul className="space-y-1.5">
                            {section.bullets.map((bullet) => (
                              <li
                                key={bullet}
                                className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed"
                              >
                                <Check className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {section.tip && (
                          <div className="rounded-lg bg-sky-50/70 border border-sky-200/80 px-4 py-3 text-xs sm:text-sm text-sky-950">
                            <span className="font-semibold text-sky-900">
                              {lang === 'fr' ? 'Astuce pratique : ' : 'Practical tip: '}
                            </span>
                            {section.tip}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Clean footer */}
      <footer className="border-t border-slate-200 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
        <span>
          {companyName} · © {new Date().getFullYear()} AGASOFT.{' '}
          {lang === 'fr' ? 'Tous droits réservés.' : 'All rights reserved.'}
        </span>
        <span className="tabular-nums">
          {lang === 'fr' ? 'Support & Contact : 225 010 220 2062' : 'Support & Contact: 225 010 220 2062'}
        </span>
      </footer>
    </div>
  );
}
