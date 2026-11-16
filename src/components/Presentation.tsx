import { useEffect, useState } from 'react';
import { Download, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { db } from '@/lib/db';
import type { Entreprise } from '@/types';

interface Feature {
  icon: string;
  title: string;
  description: string;
}

function FeatureIcon({ name }: { name: string }) {
  const map: Record<string, string> = {
    deposit: '/feature-deposit.webp',
    retrait: '/feature-deposit.webp',
    whatsapp: '/feature-deposit.webp',
    planning: '/feature-planning.webp',
    clients: '/feature-deposit.webp',
    catalogue: '/feature-deposit.webp',
    compta: '/feature-accounting.webp',
    team: '/feature-accounting.webp',
    offline: '/feature-planning.webp',
  };
  return (
    <img
      src={map[name] ?? '/feature-deposit.webp'}
      alt=""
      className="w-full h-40 object-cover rounded-xl"
    />
  );
}

export default function Presentation() {
  const { t, lang } = useI18n();
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);

  useEffect(() => {
    db.getEntreprise().then(setEntreprise);
  }, []);

  const companyName = entreprise?.nom || 'Votre entreprise';

  const FEATURES: Feature[] = [
    {
      icon: 'deposit',
      title: lang === 'fr' ? 'Dépôt & Facturation' : 'Deposit & Invoicing',
      description: lang === 'fr'
        ? 'Enregistrez les dépôts clients en quelques secondes. Sélection du client, choix des articles, type de traitement (Normal, Express, Express lendemain), calcul automatique du total et de la date de retrait prévue.'
        : 'Record client deposits in seconds. Client selection, item choice, treatment type (Normal, Express, Express next day), automatic calculation of total and expected pickup date.',
    },
    {
      icon: 'retrait',
      title: lang === 'fr' ? 'Retrait & Suivi' : 'Pickup & Tracking',
      description: lang === 'fr'
        ? 'Retirez les articles un par un ou en lot. Suivez le statut de chaque dépôt en temps réel. Le solde est calculé automatiquement et le reçu est généré à la clôture.'
        : 'Pick up items one by one or in batch. Track the status of each deposit in real time. The balance is calculated automatically and the receipt is generated on closure.',
    },
    {
      icon: 'whatsapp',
      title: lang === 'fr' ? 'Envoi par WhatsApp' : 'WhatsApp Sending',
      description: lang === 'fr'
        ? 'Envoyez les factures et reçus directement aux clients par WhatsApp. Le message est pré-formaté avec tous les détails du dépôt. Le relevé de compte peut aussi être envoyé.'
        : 'Send invoices and receipts directly to clients via WhatsApp. The message is pre-formatted with all deposit details. The account statement can also be sent.',
    },
    {
      icon: 'planning',
      title: lang === 'fr' ? 'Planning' : 'Schedule',
      description: lang === 'fr'
        ? 'Visualisez tous les dépôts et retraits prévus sur un calendrier. Identifiez rapidement les articles à traiter et les échéances de retrait.'
        : 'View all scheduled deposits and pickups on a calendar. Quickly identify items to process and pickup deadlines.',
    },
    {
      icon: 'clients',
      title: lang === 'fr' ? 'Gestion des Clients' : 'Client Management',
      description: lang === 'fr'
        ? 'Base de données clients avec code unique, téléphone, taux de remise et condition de remise. Recherche rapide et relevé de compte détaillé par client.'
        : 'Client database with unique code, phone, discount rate and discount condition. Quick search and detailed account statement per client.',
    },
    {
      icon: 'catalogue',
      title: lang === 'fr' ? "Catalogue d'Articles" : 'Item Catalog',
      description: lang === 'fr'
        ? "Définissez votre catalogue d'articles avec prix unitaire et nombre de pièces par défaut. Accélérez la saisie des dépôts avec la recherche automatique."
        : 'Define your item catalog with unit price and default number of items. Speed up deposit entry with automatic search.',
    },
    {
      icon: 'compta',
      title: lang === 'fr' ? 'Comptabilité & Dépenses' : 'Accounting & Expenses',
      description: lang === 'fr'
        ? "Suivez vos encaissements, vos dépenses par catégorie, et générez des rapports financiers. Journal des règlements, comptabilité détaillée et suivi du chiffre d'affaires."
        : 'Track your collections, expenses by category, and generate financial reports. Payment journal, detailed accounting and revenue tracking.',
    },
    {
      icon: 'team',
      title: lang === 'fr' ? 'Multi-Utilisateurs' : 'Multi-User',
      description: lang === 'fr'
        ? 'Gérez votre équipe avec des rôles (admin, gérant, employé). Chaque membre a accès aux fonctions selon son rôle. Synchronisation en temps réel entre tous les appareils.'
        : 'Manage your team with roles (admin, manager, employee). Each member has access to functions according to their role. Real-time synchronization across all devices.',
    },
    {
      icon: 'offline',
      title: lang === 'fr' ? 'Mode Hors Ligne' : 'Offline Mode',
      description: lang === 'fr'
        ? "L'application fonctionne même sans connexion Internet. Les données sont synchronisées automatiquement dès le retour de la connexion. Installable comme application mobile (PWA)."
        : 'The application works even without an Internet connection. Data is synchronized automatically as soon as the connection returns. Installable as a mobile application (PWA).',
    },
  ];

  const STEPS = [
    {
      num: '1',
      title: lang === 'fr' ? 'Créer un compte' : 'Create an account',
      description: lang === 'fr' ? 'Inscrivez-vous avec votre email et configurez les informations de votre entreprise.' : 'Sign up with your email and configure your company information.',
    },
    {
      num: '2',
      title: lang === 'fr' ? 'Ajouter vos articles' : 'Add your items',
      description: lang === 'fr' ? "Constituez votre catalogue d'articles et définissez vos types de traitement." : 'Build your item catalog and define your treatment types.',
    },
    {
      num: '3',
      title: lang === 'fr' ? 'Enregistrer les dépôts' : 'Record deposits',
      description: lang === 'fr' ? 'Saisissez les dépôts clients, calculez les prix et imprimez ou envoyez les reçus.' : 'Enter client deposits, calculate prices and print or send receipts.',
    },
    {
      num: '4',
      title: lang === 'fr' ? 'Suivre & Retirer' : 'Track & Pick up',
      description: lang === 'fr' ? 'Suivez les dépôts en cours, retirez les articles et soldez les paiements.' : 'Track ongoing deposits, pick up items and settle payments.',
    },
  ];

  return (
    <div className="print-presentation">
      {/* Toolbar - hidden on print */}
      <div className="no-print flex items-center justify-end mb-4">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" /> {lang === 'fr' ? 'Télécharger en PDF' : 'Download PDF'}
        </button>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block px-8 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{companyName}</h1>
            {entreprise?.telephone && (
              <p className="text-sm text-slate-500">{lang === 'fr' ? 'Tél' : 'Tel'}: {entreprise.telephone}</p>
            )}
            {(entreprise?.adresse || entreprise?.ville) && (
              <p className="text-sm text-slate-500">{[entreprise?.adresse, entreprise?.ville].filter(Boolean).join(', ')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="px-4 sm:px-6 pt-8 sm:pt-12 pb-8 max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="no-print inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-100 text-sky-700 text-xs font-medium mb-4">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            {lang === 'fr' ? 'Logiciel de gestion de pressing' : 'Dry cleaning management software'}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            {companyName}
          </h1>
          <p className="text-lg text-slate-500 mt-3 max-w-2xl mx-auto">
            {lang === 'fr' ? 'La solution complète pour gérer votre pressing : dépôts, retraits, facturation, comptabilité et envoi de reçus par WhatsApp.' : 'The complete solution to manage your dry cleaning business: deposits, pickups, invoicing, accounting and sending receipts via WhatsApp.'}
          </p>
        </div>

        <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200">
          <img
            src="/hero-presentation.webp"
            alt={lang === 'fr' ? `Aperçu du tableau de bord ${companyName}` : `${companyName} dashboard preview`}
            className="w-full"
          />
        </div>
      </section>

      {/* Overview */}
      <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-3">
            {t('nav.presentation')}
          </h2>
          <p className="text-slate-600 leading-relaxed">
            {lang === 'fr' ? `${companyName} est un logiciel de gestion conçu spécifiquement pour les entreprises de pressing et de blanchisserie. Il permet de gérer l'ensemble du cycle de vie d'un dépôt : de l'enregistrement du client à la remise des articles traités, en passant par la facturation, le suivi des paiements et l'envoi de reçus par WhatsApp. L'application fonctionne en ligne et hors ligne, est installable sur mobile (PWA), et synchronise les données en temps réel entre tous les appareils de votre équipe.` : `${companyName} is management software designed specifically for dry cleaning and laundry companies. It manages the entire lifecycle of a deposit: from client registration to the delivery of processed items, including invoicing, payment tracking and sending receipts via WhatsApp. The application works online and offline, is installable on mobile (PWA), and synchronizes data in real time across all your team's devices.`}
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
          {lang === 'fr' ? 'Fonctionnalités principales' : 'Main features'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col"
            >
              <div className="p-3">
                <FeatureIcon name={feature.icon} />
              </div>
              <div className="p-5 pt-2 flex-1">
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
          {lang === 'fr' ? 'Comment ça marche' : 'How it works'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-center"
            >
              <div className="w-10 h-10 rounded-full bg-sky-500 text-white font-bold text-lg flex items-center justify-center mx-auto mb-3">
                {step.num}
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                {step.title}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-white mb-5">
            {lang === 'fr' ? `Pourquoi choisir ${companyName} ?` : `Why choose ${companyName}?`}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(lang === 'fr' ? [
              'Gain de temps sur la saisie des dépôts',
              'Réduction des erreurs de facturation',
              'Suivi des paiements en temps réel',
              'Envoi de reçus par WhatsApp en un clic',
              'Fonctionnement hors ligne garanti',
              'Multi-utilisateurs avec gestion des rôles',
              'Comptabilité et suivi des dépenses intégrées',
              'Installable sur mobile comme une application',
            ] : [
              'Time saving on deposit entry',
              'Reduction of invoicing errors',
              'Real-time payment tracking',
              'Send receipts via WhatsApp in one click',
              'Guaranteed offline operation',
              'Multi-user with role management',
              'Integrated accounting and expense tracking',
              'Installable on mobile as an application',
            ]).map((benefit) => (
              <div key={benefit} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-300">{benefit}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technical specs */}
      <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4">
            {lang === 'fr' ? 'Caractéristiques techniques' : 'Technical specifications'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {(lang === 'fr' ? [
              ['Plateforme', 'Application web (PWA)'],
              ['Fonctionnement', 'En ligne et hors ligne'],
              ['Synchronisation', 'Temps réel via Supabase'],
              ['Multi-appareils', 'Oui, illimité'],
              ['Impression', 'Format A5 et ticket 80mm'],
              ['WhatsApp', 'Envoi de reçus et relevés'],
              ['Sécurité', 'Authentification, RLS par entreprise'],
              ['Hébergement', 'Cloud sécurisé'],
            ] : [
              ['Platform', 'Web application (PWA)'],
              ['Operation', 'Online and offline'],
              ['Synchronization', 'Real-time via Supabase'],
              ['Multi-device', 'Yes, unlimited'],
              ['Printing', 'A5 format and 80mm ticket'],
              ['WhatsApp', 'Send receipts and statements'],
              ['Security', 'Authentication, RLS per company'],
              ['Hosting', 'Secure cloud'],
            ]).map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">{label}</span>
                <span className="text-sm font-medium text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <div className="text-center border-t border-slate-200 pt-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <span className="text-sm font-bold text-slate-900">{companyName}</span>
          </div>
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} AGASOFT. {lang === 'fr' ? 'Tous droits réservés.' : 'All rights reserved.'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {lang === 'fr' ? 'Contact : 225 010 220 2062' : 'Contact: 225 010 220 2062'}
          </p>
        </div>
      </footer>
    </div>
  );
}
