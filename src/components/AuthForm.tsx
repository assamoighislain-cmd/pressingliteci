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
  const [alreadyRegisteredEmail, setAlreadyRegisteredEmail] = useState<string | null>(null);
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
    setAlreadyRegisteredEmail(null);

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
        if ('alreadyRegistered' in result && result.alreadyRegistered) {
          setAlreadyRegisteredEmail(normalizedEmail);
          if (result.error === 'ALREADY_REGISTERED_WRONG_PASSWORD') {
            setError(
              lang === 'fr'
                ? `Un compte existe déjà avec l'adresse « ${normalizedEmail} », mais le mot de passe saisi ne correspond pas. Connectez-vous avec votre mot de passe actuel (ou réinitialisez-le), ou demandez à l'administrateur de votre entreprise de vous ajouter directement avec cet email.`
                : `An account already exists for "${normalizedEmail}", but the password does not match. Sign in with your existing password (or reset it), or ask your company administrator to add you directly using this email.`,
            );
          } else {
            setError(
              lang === 'fr'
                ? `Un compte existe déjà avec l'adresse « ${normalizedEmail} ». Vous n'avez pas besoin de vous réinscrire : connectez-vous directement avec cet email.`
                : `An account already exists for "${normalizedEmail}". You do not need to register again: sign in directly with this email.`,
            );
          }
        } else {
          const lowerErr = result.error.toLowerCase();
          if (lowerErr.includes('email not confirmed')) {
            setError(
              lang === 'fr'
                ? `L'adresse « ${normalizedEmail} » n'est pas encore confirmée sur Supabase. Vérifiez la boîte de réception (ou les spams), ou confirmez ce compte dans Supabase → Authentication → Users (ou désactivez « Confirm email »).`
                : `The email "${normalizedEmail}" is not confirmed yet on Supabase. Check your inbox (or spam), or confirm this user in Supabase → Authentication → Users.`,
            );
          } else if (lowerErr.includes('invalid login credentials')) {
            setError(
              lang === 'fr'
                ? `Email ou mot de passe incorrect pour « ${normalizedEmail} ». Si ce compte a été créé par un administrateur ou existait déjà auparavant, demandez-lui de cliquer sur l'icône Clé (🔑) dans « Utilisateurs » pour définir un nouveau mot de passe vérifié.`
                : `Incorrect email or password for "${normalizedEmail}". If this account was created by an admin or already existed before, ask them to click the Key icon (🔑) under "Users" to set a verified password.`,
            );
          } else {
            setError(result.error);
          }
        }
      } else if ('joinRequested' in result && result.joinRequested) {
        setSignupSuccess(lang === 'fr'
          ? `Votre demande pour rejoindre « ${entrepriseNom.trim()} » a été envoyée. L'administrateur de l'entreprise (ou le Super Admin) doit l'approuver pour activer votre accès.`
          : `Your request to join "${entrepriseNom.trim()}" has been sent. The company administrator (or Super Admin) must approve it to activate your access.`);
      } else if (mode === 'signup' && joining) {
        setSignupSuccess(lang === 'fr'
          ? `Votre compte est prêt (${normalizedEmail}). L'administrateur de ${entrepriseNom.trim() ? `« ${entrepriseNom.trim()} »` : 'votre entreprise'} peut maintenant vous ajouter dans « Utilisateurs » avec cet email.`
          : `Your account is ready (${normalizedEmail}). The administrator of ${entrepriseNom.trim() ? `"${entrepriseNom.trim()}"` : 'your company'} can now add you under "Users" using this email.`);
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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-50 flex items-center justify-center px-4 py-8">
      {/* Subtle sunlit ambient accents */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-sky-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-teal-300/30 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-12 w-64 h-64 rounded-full bg-amber-200/25 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Logo + Language selector */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30 ring-4 ring-white/80">
              <Package className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">PressingLite</h1>
          <p className="text-sm font-medium text-sky-700/80 mt-1">
            {lang === 'fr' ? 'Gestion de pressing en ligne' : 'Online dry cleaning management'}
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-4">
            <Globe className="w-4 h-4 text-sky-500" />
            {(['fr', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  lang === l
                    ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white shadow-sm shadow-sky-500/25'
                    : 'bg-white/90 border border-sky-200/70 text-slate-600 hover:text-sky-700'
                }`}
              >
                {l === 'fr' ? 'Français' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white/95 backdrop-blur-md rounded-3xl border border-white shadow-2xl shadow-sky-900/10 p-7 sm:p-8">
          {/* Tabs */}
          <div className="flex gap-1.5 p-1.5 bg-sky-50/90 border border-sky-100 rounded-2xl mb-6">
            <button
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === 'signin'
                  ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white shadow-sm shadow-sky-500/25'
                  : 'text-slate-600 hover:text-sky-700'
              }`}
            >
              {t('auth.signIn')}
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === 'signup'
                  ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white shadow-sm shadow-sky-500/25'
                  : 'text-slate-600 hover:text-sky-700'
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
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    {lang === 'fr' ? 'Type de compte' : 'Account type'}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setJoining(false)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        !joining
                          ? 'border-sky-500 bg-sky-50 text-sky-900 ring-1 ring-sky-200'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-semibold">
                        {lang === 'fr' ? 'Nouvelle entreprise' : 'New company'}
                      </div>
                      <div className="text-[11px] opacity-75 mt-0.5">
                        {lang === 'fr' ? 'Créer mon pressing (Démo 30j)' : 'Create my pressing (30d Demo)'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setJoining(true)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        joining
                          ? 'border-sky-500 bg-sky-50 text-sky-900 ring-1 ring-sky-200'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-semibold">
                        {lang === 'fr' ? 'Rejoindre une équipe' : 'Join a team'}
                      </div>
                      <div className="text-[11px] opacity-75 mt-0.5">
                        {lang === 'fr' ? 'Entreprise déjà existante' : 'Existing company'}
                      </div>
                    </button>
                  </div>
                </div>
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
                    <div className="rounded-lg bg-sky-50 border border-sky-100 p-3 space-y-1.5">
                      <p className="text-xs text-sky-700">
                        {lang === 'fr'
                          ? "Indiquez le nom exact de l'entreprise (ex: Ecoclair) pour envoyer une demande d'adhésion directe, ou laissez vide afin que votre administrateur vous ajoute avec votre email."
                          : 'Enter the exact company name to send a direct join request, or leave blank so your administrator can add you by email.'}
                      </p>
                      <p className="text-xs text-sky-600/90">
                        {lang === 'fr'
                          ? "Déjà un compte ? Connectez-vous directement dans « Connexion » (ou saisissez votre mot de passe actuel ici)."
                          : 'Already have an account? Sign in directly under "Sign In" (or enter your existing password here).'}
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
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-2.5">
                <p className="text-sm text-red-700">{error}</p>
                {alreadyRegisteredEmail && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signin');
                        setEmail(alreadyRegisteredEmail);
                        setError(null);
                        setAlreadyRegisteredEmail(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 transition-colors"
                    >
                      {lang === 'fr' ? 'Aller à la connexion' : 'Go to Sign In'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signin');
                        setForgotEmail(alreadyRegisteredEmail);
                        setForgotOpen(true);
                        setForgotSent(false);
                        setError(null);
                        setAlreadyRegisteredEmail(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100/60 transition-colors"
                    >
                      {lang === 'fr' ? 'Mot de passe oublié ?' : 'Forgot password?'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 text-white font-bold text-sm hover:from-sky-600 hover:via-cyan-600 hover:to-teal-600 shadow-md shadow-sky-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 text-white font-bold text-sm hover:from-sky-600 hover:to-teal-600 shadow-sm shadow-sky-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <a
              href="#/commercial"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-sky-600 transition-colors"
            >
              {lang === 'fr' ? 'Vous êtes commercial ? Accéder au Portail Commercial →' : 'Sales agent? Open Commercial Portal →'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
