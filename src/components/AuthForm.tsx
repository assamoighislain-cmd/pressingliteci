import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n, type Lang } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { Package, Mail, Lock, Building2, Loader2, Sparkles, User, Phone, ArrowLeft, CheckCircle2, Globe, Eye, EyeOff, Hash } from 'lucide-react';
import { formatDepotNumero } from '@/lib/dbOfflineHelpers';

export default function AuthForm() {
  const { signIn, signUp } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrepriseNom, setEntrepriseNom] = useState('');
  const [depotStartInput, setDepotStartInput] = useState('');
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        setError(error.message);
      } else {
        setForgotSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'signup' && !joining && !entrepriseNom.trim()) {
        setError(lang === 'fr'
          ? 'Veuillez saisir le nom de votre entreprise, ou cochez « Je rejoins une équipe existante ».'
          : 'Please enter your company name, or check "I am joining an existing team".');
        return;
      }

      const parsedStart = depotStartInput.trim() ? parseInt(depotStartInput.trim(), 10) : null;
      const validStart = parsedStart !== null && Number.isFinite(parsedStart) && parsedStart >= 1 ? parsedStart : null;
      const normalizedEmail = email.trim().toLowerCase();

      const result = mode === 'signin'
        ? await signIn(normalizedEmail, password)
        : await signUp(
            normalizedEmail,
            password,
            entrepriseNom.trim(),
            fullName.trim(),
            contact.trim(),
            joining ? null : validStart,
            joining,
          );

      if (result.error) {
        setError(result.error);
      } else if ('joinRequested' in result && result.joinRequested) {
        setSignupSuccess(lang === 'fr'
          ? `Votre demande pour rejoindre « ${entrepriseNom.trim()} » a été envoyée. L'administrateur de l'entreprise (ou le Super Admin) doit l'approuver pour activer votre accès.`
          : `Your request to join "${entrepriseNom.trim()}" has been sent. The company administrator (or Super Admin) must approve it to activate your access.`);
      } else if (mode === 'signup' && joining) {
        setSignupSuccess(lang === 'fr'
          ? `Votre compte a été créé (${normalizedEmail}). L'administrateur de votre entreprise peut maintenant vous ajouter dans « Utilisateurs » avec cet email.`
          : `Your account has been created (${normalizedEmail}). Your company administrator can now add you under "Users" using this email.`);
      } else if (mode === 'signup' && !joining) {
        setSignupSuccess(lang === 'fr'
          ? `Félicitations ! Votre entreprise « ${entrepriseNom.trim()} » a été créée avec une licence Démo gratuite de 30 jours activée automatiquement. Un administrateur va valider votre compte et vous serez notifié par message Push.`
          : `Congratulations! Your company "${entrepriseNom.trim()}" has been created with a free 30-day Demo license activated automatically. A platform administrator will validate your account and you will be notified by Push message.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-cyan-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo + Language selector */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-lg">
              <Package className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">PressingLite</h1>
          <p className="text-sm text-slate-500 mt-1">
            {lang === 'fr' ? 'Gestion de pressing en ligne' : 'Online dry cleaning management'}
          </p>
          <div className="flex items-center justify-center gap-1 mt-4">
            <Globe className="w-4 h-4 text-slate-400" />
            {(['fr', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  lang === l
                    ? 'bg-sky-500 text-white'
                    : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700'
                }`}
              >
                {l === 'fr' ? 'Français' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl p-8">
          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
            <button
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('auth.signIn')}
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('auth.signUp')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {signupSuccess && mode === 'signup' && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-700">{signupSuccess}</p>
              </div>
            )}
            {mode === 'signup' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {t('auth.fullName')}
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('auth.fullNamePlaceholder')}
                        className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {t('auth.phone')}
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="tel"
                        required
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder={t('auth.phonePlaceholder')}
                        className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={joining}
                    onChange={(e) => setJoining(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                  />
                  {lang === 'fr' ? 'Je rejoins une équipe existante' : 'I am joining an existing team'}
                </label>
                {!joining && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        {t('auth.companyName')}
                      </label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={entrepriseNom}
                          onChange={(e) => setEntrepriseNom(e.target.value)}
                          placeholder={t('auth.companyNamePlaceholder')}
                          className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        {lang === 'fr'
                          ? 'Compteur de départ des dépôts (optionnel)'
                          : 'Starting deposit counter (optional)'}
                      </label>
                      <div className="relative">
                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={depotStartInput}
                          onChange={(e) => setDepotStartInput(e.target.value)}
                          placeholder={lang === 'fr' ? 'Par défaut : 1 (ex: 450)' : 'Default: 1 (e.g. 450)'}
                          className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {(() => {
                          const n = parseInt(depotStartInput.trim(), 10);
                          const previewSeq = Number.isFinite(n) && n >= 1 ? n : 1;
                          const preview = formatDepotNumero(previewSeq, new Date().getFullYear(), '');
                          return lang === 'fr'
                            ? `Premier numéro de dépôt imposé : ${preview}`
                            : `First enforced deposit number: ${preview}`;
                        })()}
                      </p>
                    </div>
                  </>
                )}
                {joining && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        {lang === 'fr'
                          ? "Nom de l'entreprise à rejoindre (optionnel)"
                          : 'Company name to join (optional)'}
                      </label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={entrepriseNom}
                          onChange={(e) => setEntrepriseNom(e.target.value)}
                          placeholder={lang === 'fr' ? 'Ex: Ecoclair' : 'Ex: Ecoclair'}
                          className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
                      <p className="text-xs text-sky-700">
                        {lang === 'fr'
                          ? "Indiquez le nom exact de l'entreprise (ex: Ecoclair) pour envoyer une demande d'adhésion directe, ou laissez vide afin que votre administrateur vous ajoute avec votre email."
                          : 'Enter the exact company name to send a direct join request, or leave blank so your administrator can add you by email.'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('auth.email')}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('auth.password')}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('pw.placeholder')}
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && !forgotOpen && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'signin'
                    ? (lang === 'fr' ? 'Connexion…' : 'Signing in…')
                    : (lang === 'fr' ? 'Création…' : 'Creating…')}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {mode === 'signin' ? t('auth.signInBtn') : t('auth.signUpBtn')}
                </>
              )}
            </button>
          </form>

          {mode === 'signin' && !forgotOpen && (
            <div className="text-center mt-3">
              <button
                onClick={() => { setForgotOpen(true); setError(null); setForgotSent(false); }}
                className="text-xs text-slate-500 hover:text-sky-600 transition-colors"
              >
                {lang === 'fr' ? 'Mot de passe oublié ?' : 'Forgot password?'}
              </button>
            </div>
          )}

          {forgotOpen && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <button
                onClick={() => { setForgotOpen(false); setError(null); setForgotSent(false); setForgotEmail(''); }}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {lang === 'fr' ? 'Retour à la connexion' : 'Back to sign in'}
              </button>

              {forgotSent ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-700">
                      {lang === 'fr' ? 'Email envoyé !' : 'Email sent!'}
                    </p>
                    <p className="text-xs text-emerald-600 mt-1">
                      {lang === 'fr'
                        ? `Un lien de réinitialisation a été envoyé à ${forgotEmail}. Vérifiez votre boîte de réception (et vos spams).`
                        : `A reset link has been sent to ${forgotEmail}. Check your inbox (and spam folder).`}
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-3">
                  <p className="text-sm text-slate-600">
                    {lang === 'fr'
                      ? "Saisissez votre adresse email. Vous recevrez un lien pour réinitialiser votre mot de passe."
                      : 'Enter your email address. You will receive a link to reset your password.'}
                  </p>
                  <div>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder={t('auth.emailPlaceholder')}
                        className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-sm text-red-600">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full px-4 py-2.5 rounded-lg bg-sky-500 text-white font-medium text-sm hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {forgotLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />
                      {lang === 'fr' ? 'Envoi…' : 'Sending…'}</>
                    ) : (
                      <>{lang === 'fr' ? 'Envoyer le lien de réinitialisation' : 'Send reset link'}</>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 text-center mt-5">
            {mode === 'signin' ? t('auth.noAccount') : t('auth.alreadyHaveAccount')}{' '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setForgotOpen(false); }}
              className="text-sky-600 font-medium hover:underline"
            >
              {mode === 'signin' ? t('auth.createAccount') : t('auth.signIn')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
