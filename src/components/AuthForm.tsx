import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n, type Lang } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { Package, Mail, Lock, Building2, Loader2, Sparkles, User, Phone, ArrowLeft, CheckCircle2, Globe, Eye, EyeOff } from 'lucide-react';

export default function AuthForm() {
  const { signIn, signUp } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrepriseNom, setEntrepriseNom] = useState('');
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
      if (mode === 'signup' && !entrepriseNom.trim()) {
        setError(lang === 'fr'
          ? 'Veuillez saisir le nom de votre entreprise, ou cochez « Je rejoins une équipe existante ».'
          : 'Please enter your company name, or check "I am joining an existing team".');
        return;
      }

      const result = mode === 'signin'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, joining ? '' : entrepriseNom.trim(), fullName.trim(), contact.trim());

      if (result.error) {
        setError(result.error);
      } else if ('joinRequested' in result && result.joinRequested) {
        setSignupSuccess(lang === 'fr'
          ? `Votre demande de rejoindre « ${entrepriseNom.trim()} » a été envoyée. L'administrateur de l'entreprise doit approuver votre demande avant que vous puissiez accéder au compte.`
          : `Your request to join "${entrepriseNom.trim()}" has been sent. The company administrator must approve your request before you can access the account.`);
      } else if (mode === 'signup' && !joining) {
        setSignupSuccess(lang === 'fr'
          ? `Votre entreprise « ${entrepriseNom.trim()} » a été créée. Un administrateur de la plateforme doit valider votre compte avant que vous puissiez accéder au logiciel. Vous serez notifié dès que votre compte sera activé.`
          : `Your company "${entrepriseNom.trim()}" has been created. A platform administrator must validate your account before you can access the software. You will be notified once your account is activated.`);
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
                )}
                {joining && (
                  <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
                    <p className="text-xs text-sky-700">
                      {lang === 'fr'
                        ? "Créez votre compte avec le même email que celui utilisé par l'administrateur pour vous inviter. Une fois connecté, vous aurez accès à l'entreprise."
                        : 'Create your account with the same email used by the administrator to invite you. Once logged in, you will have access to the company.'}
                    </p>
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
