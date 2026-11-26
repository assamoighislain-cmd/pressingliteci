import { useState } from 'react';
import { db } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { Commercial, Entreprise, buildWhatsAppUrl } from '@/types';
import {
  X,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  ExternalLink,
  MessageCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface CommercialPortalShareModalProps {
  commercial: Commercial;
  entreprise: Entreprise | null;
  canManage: boolean;
  onClose: () => void;
  onCodeUpdated: (newCode: string) => Promise<void> | void;
}

export default function CommercialPortalShareModal({
  commercial,
  entreprise,
  canManage,
  onClose,
  onCodeUpdated,
}: CommercialPortalShareModalProps) {
  const { lang } = useI18n();
  const [code, setCode] = useState(commercial.portal_code ?? '');
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'code' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portalUrl = (() => {
    const base = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
    return entreprise?.id
      ? `${base}#/commercial/${entreprise.id}`
      : `${base}#/commercial`;
  })();

  function copyText(text: string, which: 'code' | 'link') {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(which);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await db.regenerateCommercialPortalCode(commercial.id);
      if (res.error || !res.code) {
        setError(
          res.error ??
            (lang === 'fr'
              ? 'Impossible de générer un code. Vérifiez que la mise à jour SQL a été appliquée.'
              : 'Unable to generate code. Please ensure the SQL update has been applied.'),
        );
        return;
      }
      setCode(res.code);
      await onCodeUpdated(res.code);
    } finally {
      setRegenerating(false);
    }
  }

  const whatsappMessage =
    lang === 'fr'
      ? `Bonjour ${commercial.nom},\nVoici votre accès au Portail Commercial${entreprise?.nom ? ` (${entreprise.nom})` : ''} pour suivre vos clients, factures et commissions :\nLien : ${portalUrl}\nCode d'accès : ${code}`
      : `Hello ${commercial.nom},\nHere is your Sales Agent Portal access${entreprise?.nom ? ` (${entreprise.nom})` : ''}:\nLink: ${portalUrl}\nAccess code: ${code}`;

  const whatsappHref = commercial.telephone
    ? buildWhatsAppUrl(commercial.telephone, whatsappMessage)
    : `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200/70 text-sky-700 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'fr' ? 'Accès Portail Commercial' : 'Sales Portal Access'}
              </h3>
              <p className="text-xs text-slate-500">{commercial.nom}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Code block */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-500">
            {lang === 'fr' ? 'Code personnel du commercial' : 'Personal access code'}
          </label>
          {code ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-base font-bold tracking-wider text-slate-900 select-all">
                {code}
              </div>
              <button
                type="button"
                onClick={() => copyText(code, 'code')}
                className="px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium inline-flex items-center gap-1.5"
              >
                {copiedKey === 'code' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copiedKey === 'code' ? (lang === 'fr' ? 'Copié' : 'Copied') : (lang === 'fr' ? 'Copier' : 'Copy')}
              </button>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800">
              {lang === 'fr'
                ? 'Aucun code généré pour ce commercial. Cliquez sur « Générer un code » (après avoir appliqué la mise à jour SQL).'
                : 'No code generated yet. Click "Generate code" (after running the SQL update).'}
            </div>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-sky-700 pt-1"
            >
              {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {code
                ? (lang === 'fr' ? 'Régénérer un nouveau code' : 'Regenerate new code')
                : (lang === 'fr' ? 'Générer un code' : 'Generate code')}
            </button>
          )}
        </div>

        {/* Portal URL block */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-500">
            {lang === 'fr' ? 'Lien direct du portail' : 'Direct portal link'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={portalUrl}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 truncate"
            />
            <button
              type="button"
              onClick={() => copyText(portalUrl, 'link')}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedKey === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copiedKey === 'link' ? (lang === 'fr' ? 'Copié' : 'Copied') : (lang === 'fr' ? 'Lien' : 'Link')}
            </button>
          </div>
        </div>

        {/* Share actions */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
          {code && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4" />
              {lang === 'fr' ? 'Envoyer par WhatsApp' : 'Share via WhatsApp'}
            </a>
          )}
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {lang === 'fr' ? 'Ouvrir le portail' : 'Open portal'}
          </a>
        </div>
      </div>
    </div>
  );
}
