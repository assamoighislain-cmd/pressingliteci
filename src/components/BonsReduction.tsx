import { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import { BonReduction, Entreprise, formatPrice } from '@/types';
import { Ticket, Plus, Trash2, Share2, Printer, Power, PowerOff, Copy, Check, MessageCircle, X, Pencil } from 'lucide-react';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getBonStatus(bon: BonReduction, t: (k: string) => string): { label: string; color: string } {
  if (!bon.actif) return { label: t('bons.inactif'), color: 'bg-slate-100 text-slate-600' };
  if (bon.date_fin && new Date(bon.date_fin) < new Date()) return { label: t('bons.expired'), color: 'bg-red-100 text-red-600' };
  if (bon.usage_max !== null && bon.usage_count >= bon.usage_max) return { label: t('bons.epuise'), color: 'bg-amber-100 text-amber-700' };
  return { label: t('bons.actif'), color: 'bg-emerald-100 text-emerald-700' };
}

export default function BonsReduction() {
  const { t, lang } = useI18n();
  const [bons, setBons] = useState<BonReduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Form state (shared for create & edit)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState(generateCode());
  const [typeRemise, setTypeRemise] = useState<'pourcentage' | 'montant_fixe'>('pourcentage');
  const [valeur, setValeur] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [usageMax, setUsageMax] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [bonsData, ent] = await Promise.all([db.getBonsReduction(), db.getEntreprise()]);
      setBons(bonsData);
      setEntreprise(ent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setCode(generateCode());
    setTypeRemise('pourcentage');
    setValeur('');
    setDateFin('');
    setUsageMax('');
    setDescription('');
    setShowForm(false);
    setEditingId(null);
    setError(null);
  }

  function openCreate() {
    setEditingId(null);
    setCode(generateCode());
    setTypeRemise('pourcentage');
    setValeur('');
    setDateFin('');
    setUsageMax('');
    setDescription('');
    setError(null);
    setShowForm(true);
  }

  function openEdit(bon: BonReduction) {
    setEditingId(bon.id);
    setCode(bon.code);
    setTypeRemise(bon.type_remise);
    setValeur(String(bon.valeur));
    setDateFin(bon.date_fin ? new Date(bon.date_fin).toISOString().slice(0, 10) : '');
    setUsageMax(bon.usage_max != null ? String(bon.usage_max) : '');
    setDescription(bon.description ?? '');
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit() {
    if (!code.trim() || !(parseFloat(valeur) > 0)) return;
    setSubmitting(true);
    setError(null);
    try {
      const isEdit = editingId !== null;
      const payload = {
        code: code.trim().toUpperCase(),
        type_remise: typeRemise,
        valeur: parseFloat(valeur),
        date_fin: dateFin ? new Date(dateFin + 'T23:59:59').toISOString() : null,
        usage_max: usageMax ? parseInt(usageMax) : null,
        description: description.trim() || null,
      };

      if (isEdit && editingId) {
        const err = await db.updateBonReduction(editingId, payload);
        if (err) { setError(err); return; }
      } else {
        const res = await db.insertBonReduction({ ...payload, date_debut: new Date().toISOString() });
        if (res.error) { setError(res.error); return; }
      }
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActif(bon: BonReduction) {
    await db.updateBonReduction(bon.id, { actif: !bon.actif });
    await loadData();
  }

  async function handleDelete(id: string) {
    await db.deleteBonReduction(id);
    await loadData();
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  function buildCouponMessage(bon: BonReduction): string {
    const name = entreprise?.nom ?? 'Notre pressing';
    const discountText = bon.type_remise === 'pourcentage'
      ? `${bon.valeur}%`
      : formatPrice(bon.valeur);
    const expiry = bon.date_fin
      ? (lang === 'fr' ? `Valable jusqu'au ${formatDateShort(bon.date_fin)}` : `Valid until ${formatDateShort(bon.date_fin)}`)
      : (lang === 'fr' ? 'Sans date limite' : 'No expiry date');
    return lang === 'fr'
      ? `🎉 *${name}* vous offre une réduction de *${discountText}* !\n\n🏷️ Code promo : *${bon.code}*\n📅 ${expiry}\n${bon.description ? `\n💬 ${bon.description}\n` : ''}\nPrésentez ce code lors de votre prochain dépôt pour en profiter !`
      : `🎉 *${name}* offers you a *${discountText}* discount!\n\n🏷️ Promo code: *${bon.code}*\n📅 ${expiry}\n${bon.description ? `\n💬 ${bon.description}\n` : ''}\nPresent this code at your next deposit to enjoy the offer!`;
  }

  function shareWhatsApp(bon: BonReduction) {
    const msg = buildCouponMessage(bon);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function printCoupon(bon: BonReduction) {
    const name = entreprise?.nom ?? '';
    const discountText = bon.type_remise === 'pourcentage'
      ? `${bon.valeur}%`
      : formatPrice(bon.valeur);
    const expiry = bon.date_fin ? formatDateShort(bon.date_fin) : (lang === 'fr' ? 'Sans limite' : 'No expiry');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Coupon</title>
<style>
@page { size: 148mm 105mm; margin: 0; }
body { margin: 0; font-family: system-ui, sans-serif; }
.coupon {
  width: 148mm; height: 105mm; box-sizing: border-box;
  border: 3px dashed #0ea5e9; border-radius: 16px; padding: 12mm;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
}
.name { font-size: 14pt; font-weight: 700; color: #0f172a; margin-bottom: 4mm; }
.discount { font-size: 32pt; font-weight: 800; color: #0ea5e9; margin-bottom: 3mm; }
.label { font-size: 10pt; color: #64748b; margin-bottom: 2mm; }
.code { font-size: 18pt; font-weight: 700; letter-spacing: 3px; background: #f0f9ff; border: 2px dashed #0ea5e9; border-radius: 8px; padding: 3mm 6mm; color: #0369a1; margin-bottom: 4mm; }
.expiry { font-size: 9pt; color: #94a3b8; }
.desc { font-size: 10pt; color: #475569; margin-bottom: 3mm; }
</style></head><body>
<div class="coupon">
  <div class="name">${name}</div>
  <div class="label">${lang === 'fr' ? 'BON DE RÉDUCTION' : 'DISCOUNT COUPON'}</div>
  <div class="discount">-${discountText}</div>
  ${bon.description ? `<div class="desc">${bon.description}</div>` : ''}
  <div class="code">${bon.code}</div>
  <div class="expiry">${lang === 'fr' ? 'Valable jusqu\'au' : 'Valid until'}: ${expiry}</div>
</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=600,height=400');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Ticket className="w-5 h-5 text-sky-500" />
            {t('bons.title')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{t('bons.subtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> {t('bons.add')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingId ? t('bons.editTitle') : t('bons.add')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('bons.code')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t('bons.codePlaceholder')}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setCode(generateCode())}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  {t('bons.autoCode')}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('bons.type')}</label>
              <select
                value={typeRemise}
                onChange={(e) => setTypeRemise(e.target.value as 'pourcentage' | 'montant_fixe')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
              >
                <option value="pourcentage">{t('bons.pourcentage')}</option>
                <option value="montant_fixe">{t('bons.montant_fixe')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('bons.valeur')} {typeRemise === 'pourcentage' ? '(%)' : `(${lang === 'fr' ? 'FCFA' : 'FCFA'})`}
              </label>
              <input
                type="number"
                min="1"
                max={typeRemise === 'pourcentage' ? 100 : undefined}
                value={valeur}
                onChange={(e) => setValeur(e.target.value)}
                placeholder={typeRemise === 'pourcentage' ? 'Ex: 10' : 'Ex: 2000'}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('bons.dateFin')} <span className="text-slate-400 font-normal">({t('bons.noExpiry')})</span>
              </label>
              <input
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('bons.usageMax')} <span className="text-slate-400 font-normal">({t('bons.unlimited')})</span>
              </label>
              <input
                type="number"
                min="1"
                value={usageMax}
                onChange={(e) => setUsageMax(e.target.value)}
                placeholder={t('bons.unlimited')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('bons.description')}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('bons.descPlaceholder')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={resetForm}
              className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t('bons.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !code.trim() || !(parseFloat(valeur) > 0)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {editingId ? t('bons.save') : t('bons.add')}
            </button>
          </div>
        </div>
      )}

      {/* Bons list */}
      {bons.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-12 text-center">
          <Ticket className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('bons.empty')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {bons.map((bon) => {
            const status = getBonStatus(bon, t);
            const discountText = bon.type_remise === 'pourcentage'
              ? `${bon.valeur}%`
              : formatPrice(bon.valeur);
            return (
              <div key={bon.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-lg font-bold tracking-wider text-sky-700 bg-sky-50 px-3 py-1 rounded-lg border border-sky-100">
                        {bon.code}
                      </span>
                      <button
                        onClick={() => copyCode(bon.code)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                        title="Copy"
                      >
                        {copied === bon.code ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm mb-1">
                      <span className="font-bold text-2xl text-slate-900">-{discountText}</span>
                      {bon.description && <span className="text-slate-500 truncate">{bon.description}</span>}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
                      <span>{t('bons.usage')}: <strong className="text-slate-700">{bon.usage_count}{bon.usage_max ? ` / ${bon.usage_max}` : ''}</strong> {t('bons.times')}</span>
                      <span>{t('bons.dateDebut')}: <strong className="text-slate-700">{formatDateShort(bon.date_debut)}</strong></span>
                      {bon.date_fin && <span>{t('bons.dateFin')}: <strong className="text-slate-700">{formatDateShort(bon.date_fin)}</strong></span>}
                      {!bon.date_fin && <span className="text-emerald-600">{t('bons.noExpiry')}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => shareWhatsApp(bon)}
                      className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title="WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => printCoupon(bon)}
                      className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                      title={t('bons.print')}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleActif(bon)}
                      className={`p-2 rounded-lg transition-colors ${bon.actif ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                      title={bon.actif ? t('bons.deactivate') : t('bons.activate')}
                    >
                      {bon.actif ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => openEdit(bon)}
                      className="p-2 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors"
                      title={t('bons.edit')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(bon.id)}
                      className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title={t('bons.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div ref={printRef} className="hidden" />
    </div>
  );
}
