import type { Lang } from '@/lib/i18n';

export interface PresentationModule {
  id: string;
  title: string;
  category: string;
  summary: string;
  highlights: string[];
}

export interface WorkflowStep {
  num: string;
  title: string;
  description: string;
}

export interface RolePermissionRow {
  role: string;
  scope: string;
  keyActions: string;
}

export interface GuideSection {
  heading: string;
  intro?: string;
  steps?: string[];
  bullets?: string[];
  tip?: string;
}

export interface GuideChapter {
  number: string;
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  sections: GuideSection[];
}

export function getPresentationModules(lang: Lang): PresentationModule[] {
  if (lang === 'en') {
    return [
      {
        id: 'depot',
        title: 'Deposits & Fast Invoicing',
        category: 'Operations',
        summary:
          '3-step guided entry (Client, Items, Payment) with instant in-memory search across 4,000+ clients, Normal treatment preselected by default, and automatic pickup date calculation.',
        highlights: [
          'Instant client lookup by name, phone, or code (<1 ms)',
          'Multi-payment lines, client discounts, promo coupons, and loyalty points',
          'A5 receipt, 80/100 mm thermal ticket with operator name, garment labels, and 1-click WhatsApp',
          'Auto-saved draft and deferred updates so an active deposit is never interrupted',
        ],
      },
      {
        id: 'retrait',
        title: 'Pickups, Workshop & Treatment Edits',
        category: 'Operations',
        summary:
          'Track every garment from intake to handover with partial or full pickup, automatic balance settlement, and post-validation treatment type edits.',
        highlights: [
          'Item-by-item or full deposit pickup with live balance settlement',
          'Edit the treatment type of a validated deposit with automatic price recalculation',
          'Calendar schedule of pending pickups, full history, and live workshop inventory',
        ],
      },
      {
        id: 'commerciaux',
        title: 'Referral Partners, Commissions & Partner Portal',
        category: 'Growth',
        summary:
          'Manage referral partners with custom commission rates, link multiple clients over predefined day periods, track payouts, and give each partner a standalone portal.',
        highlights: [
          'Link multiple clients to a referral partner for a set number of days (all client invoices earn commission)',
          'Automatic attribution on new deposits plus direct linking on any invoice',
          'Payout ledger with remaining balance and optional expense booking',
          'Dedicated Partner Portal accessible via personal code (COM-XXXXXXXX)',
        ],
      },
      {
        id: 'logistique',
        title: 'Online Orders, Pickup & Delivery Maps',
        category: 'Logistics',
        summary:
          'Give customers a QR-code Client Portal for tracking and online orders, and dispatch collectors and drivers on interactive Google Maps.',
        highlights: [
          'Client Portal with order tracking, loyalty balance, and online requests',
          'Geolocated pickup and delivery runs with interactive Google Maps view',
          'Real-time sound and Web Push alerts for new orders and pickup requests',
        ],
      },
      {
        id: 'clients',
        title: 'Clients, Catalog, Coupons & Consumables',
        category: 'Customer Care',
        summary:
          'Centralize your customer base, item pricing variants, promotional vouchers, and pressing supplies inventory in one workspace.',
        highlights: [
          'Normalized client code prefixes per store, Excel import, and detailed account statements',
          'Catalog items with treatment variants, piece counts, colors, brands, and defect notes',
          'Consumables stock tracking (detergents, hangers, covers) with low-stock alerts',
        ],
      },
      {
        id: 'finances',
        title: 'Accounting, Ledgers & Expenses',
        category: 'Finance',
        summary:
          'Monitor daily collections, payment methods, categorized expenses, and printable A4 management reports in real time.',
        highlights: [
          'Live KPI dashboard, Deposit Journal, and Payment Journal',
          'Expense tracking by category and comprehensive accounting summary',
          'Paginated A4 printable reports and Excel data export',
        ],
      },
      {
        id: 'equipe',
        title: 'Multi-Store, Team Roles & Security',
        category: 'Administration',
        summary:
          'Operate multiple storefronts with independent receipt headers, starting counters, strict role-based permissions, and company-level data isolation.',
        highlights: [
          'Per-store receipt header, geolocation, and independent annual numbering (D-001-2026)',
          'Six roles: Admin, Manager, Sales/Cashier, Collector/Driver, Accountant, and Associate (Read-only)',
          'Row-Level Security (RLS) isolation per company with license governance',
        ],
      },
      {
        id: 'offline',
        title: 'Offline-First PWA & Real-Time Sync',
        category: 'Reliability',
        summary:
          'Installable on Android, iOS, Windows, and macOS. Continues working seamlessly without Internet and synchronizes automatically once reconnected.',
        highlights: [
          'Local IndexedDB read cache and automatic background mutation sync queue',
          'Collision-free numbering across multiple billing terminals',
          'Zero-disruption updates that wait until any active deposit is completed',
        ],
      },
    ];
  }

  return [
    {
      id: 'depot',
      title: 'Dépôt & Facturation rapide',
      category: 'Opérations',
      summary:
        'Saisie guidée en 3 étapes (Client, Articles, Paiement) avec recherche client instantanée sur plus de 4 000 fiches, traitement Normal présélectionné par défaut et calcul automatique du retrait.',
      highlights: [
        'Recherche client instantanée par nom, téléphone ou code (< 1 ms)',
        'Multi-règlements, remises clients, bons de réduction et points de fidélité',
        'Impression A5, ticket thermique 80/100 mm avec nom de l\'opérateur, étiquettes et WhatsApp en 1 clic',
        'Sauvegarde automatique du brouillon et mises à jour différées pendant un dépôt en cours',
      ],
    },
    {
      id: 'retrait',
      title: 'Retrait, Atelier & Modification de traitement',
      category: 'Opérations',
      summary:
        'Suivez chaque vêtement du comptoir jusqu\'à la remise finale avec retrait partiel ou total, encaissement du solde et modification possible du traitement après validation.',
      highlights: [
        'Retrait article par article ou par lot avec calcul automatique du reste à payer',
        'Modification du type de traitement d\'un dépôt déjà validé avec recalcul des montants',
        'Planning calendrier des échéances, historique complet et inventaire de l\'atelier',
      ],
    },
    {
      id: 'commerciaux',
      title: "Apporteurs d'affaire, Commissions & Portail dédié",
      category: 'Développement',
      summary:
        "Pilotez votre réseau d'apporteurs d'affaire : taux de commission personnalisé, liaison multi-clients sur une durée en jours, suivi des versements et portail autonome par code.",
      highlights: [
        "Rattachement d'un ou plusieurs clients sur un nombre de jours défini (commission sur toutes leurs factures)",
        'Attribution automatique sur les nouveaux dépôts ou association directe sur facture',
        'Suivi du CA apporté, commissions générées, versements et solde restant à payer',
        "Portail Apporteur d'affaire sécurisé accessible par code personnel (COM-XXXXXXXX)",
      ],
    },
    {
      id: 'logistique',
      title: 'Commandes, Collecte & Livraison (Google Maps)',
      category: 'Logistique',
      summary:
        'Offrez un Portail Client accessible par QR Code pour le suivi et la prise de commande, et organisez vos tournées de collecte et livraison sur carte interactive.',
      highlights: [
        'Portail Client pour suivre l\'avancement des dépôts, les points de fidélité et commander',
        'Tournées de collecte et livraison géolocalisées sur carte Google Maps',
        'Alertes sonores et notifications Push en temps réel pour les nouvelles demandes',
      ],
    },
    {
      id: 'clients',
      title: 'Clients, Catalogue, Bons & Consommables',
      category: 'Relation client',
      summary:
        'Centralisez votre fichier clients, vos tarifs avec variantes, vos campagnes de bons de réduction et votre stock de consommables pressing.',
      highlights: [
        'Codes clients normalisés par préfixe boutique, import Excel et relevé de compte client',
        'Catalogue d\'articles avec variantes de prix, nombre de pièces, couleurs, griffes et observations',
        'Stock de consommables (lessive, cintres, housses) avec mouvements et seuils d\'alerte',
      ],
    },
    {
      id: 'finances',
      title: 'Comptabilité, Journaux & Dépenses',
      category: 'Finances',
      summary:
        'Suivez vos encaissements quotidiens par mode de règlement, vos dépenses classées par catégorie et éditez des rapports A4 prêts à imprimer.',
      highlights: [
        'Tableau de bord temps réel, Journal des dépôts et Journal des règlements',
        'Suivi des dépenses par catégorie et synthèse comptable détaillée',
        'Rapports A4 paginés imprimables et exports Excel',
      ],
    },
    {
      id: 'equipe',
      title: 'Multi-Boutiques, Rôles & Sécurité',
      category: 'Administration',
      summary:
        'Pilotez plusieurs agences depuis un même compte avec en-têtes de reçus propres, compteurs indépendants, droits par rôle et isolation complète des données.',
      highlights: [
        'En-tête de reçu, géolocalisation et numérotation annuelle (D-001-2026) propres à chaque boutique',
        'Six rôles dédiés : Administrateur, Gérant, Commercial/Caissier, Collecteur/Livreur, Comptable et Associé (Consultation)',
        'Sécurité par entreprise (RLS Supabase) et suivi de licence intégré',
      ],
    },
    {
      id: 'offline',
      title: 'Mode Hors-Ligne PWA & Sync Temps Réel',
      category: 'Fiabilité',
      summary:
        'Installable sur Android, iOS, Windows et macOS. Travaillez sans coupure même sans Internet : toutes vos opérations se synchronisent dès le retour du réseau.',
      highlights: [
        'Cache local IndexedDB et file d\'attente de synchronisation automatique en arrière-plan',
        'Numérotation sans doublon entre plusieurs postes de facturation',
        'Mises à jour intelligentes qui ne perturbent jamais un dépôt en cours',
      ],
    },
  ];
}

export function getWorkflowSteps(lang: Lang): WorkflowStep[] {
  if (lang === 'en') {
    return [
      {
        num: '01',
        title: 'Configure your workspace',
        description:
          'Set up your company details, store headers, starting deposit counter, item catalog, treatment types, and payment methods.',
      },
      {
        num: '02',
        title: 'Record deposits in seconds',
        description:
          'Find a client instantly, add items with Normal treatment preselected, apply discounts or referral partner attribution, and print or send via WhatsApp.',
      },
      {
        num: '03',
        title: 'Track workshop & pickups',
        description:
          'Follow deadlines on the schedule, adjust treatment types if needed, process partial or full pickups, and collect remaining balances.',
      },
      {
        num: '04',
        title: 'Monitor finances & referral partners',
        description:
          'Review daily journals, expenses, consumables stock, and referral partner commissions from the dashboard or printable A4 reports.',
      },
    ];
  }

  return [
    {
      num: '01',
      title: 'Paramétrer votre pressing',
      description:
        'Renseignez votre entreprise, vos boutiques, votre compteur de départ, votre catalogue d\'articles, vos traitements et vos modes de règlement.',
    },
    {
      num: '02',
      title: 'Enregistrer vos dépôts',
      description:
        'Recherchez le client en un instant, ajoutez les articles (traitement Normal par défaut), encaissez et imprimez ou envoyez le reçu par WhatsApp.',
    },
    {
      num: '03',
      title: 'Suivre l\'atelier & les retraits',
      description:
        'Pilotez les échéances au planning, modifiez un traitement si besoin, effectuez les retraits partiels ou totaux et soldez les factures.',
    },
    {
      num: '04',
      title: "Piloter finances & apporteurs d'affaire",
      description:
        "Consultez les journaux, les dépenses, les stocks consommables et les commissions des apporteurs d'affaire depuis le tableau de bord ou en rapports A4.",
    },
  ];
}

export function getRoleMatrix(lang: Lang): RolePermissionRow[] {
  if (lang === 'en') {
    return [
      {
        role: 'Administrator',
        scope: 'All stores & company settings',
        keyActions:
          'Full access: deposits, pickups, clients, catalog, accounting, expenses, referral partners & payouts, multi-store setup, team & roles, starting counters.',
      },
      {
        role: 'Manager',
        scope: 'Assigned store',
        keyActions:
          'Operations, pickups, planning, clients, catalog, journals, expenses, referral partners & client linking, consumables, and store counters.',
      },
      {
        role: 'Sales / Cashier',
        scope: 'Assigned store',
        keyActions:
          'Front-desk deposits, pickups, payment collection, editing treatment type on validated deposits, client creation, WhatsApp receipts, and schedule view.',
      },
      {
        role: 'Collector / Driver',
        scope: 'Field logistics',
        keyActions:
          'Geolocated pickup and delivery runs, map routing, order collection confirmation, and customer handover updates.',
      },
      {
        role: 'Accountant',
        scope: 'All stores (or assigned store)',
        keyActions:
          'Dashboard, deposit & payment journals, accounting reports, client statements, full expense & category management, referral partner commission payouts, and read-only view of clients, workshop inventory, and consumables.',
      },
      {
        role: 'Associate (Read-only)',
        scope: 'All stores (or assigned store)',
        keyActions:
          'Strictly read-only access and printing across Dashboard, schedule, history, journals, accounting, expenses, referral partners, statements, clients, catalog, inventory, consumables, and stores — no create, edit, or delete actions.',
      },
    ];
  }

  return [
    {
      role: 'Administrateur',
      scope: 'Toutes les boutiques & réglages',
      keyActions:
        "Accès complet : dépôts, retraits, clients, catalogue, comptabilité, dépenses, apporteurs d'affaire et versements, multi-boutiques, équipe et rôles, compteurs de départ.",
    },
    {
      role: 'Gérant',
      scope: 'Boutique affectée',
      keyActions:
        "Gestion quotidienne, dépôts, retraits, planning, clients, catalogue, journaux, dépenses, gestion des apporteurs d'affaire et liaisons clients, consommables et compteurs.",
    },
    {
      role: 'Commercial / Caissier',
      scope: 'Boutique affectée',
      keyActions:
        'Accueil comptoir : création de dépôts, encaissements, retraits, modification du type de traitement d\'un dépôt validé, création clients, reçus WhatsApp et planning.',
    },
    {
      role: 'Collecteur / Livreur',
      scope: 'Tournées terrain',
      keyActions:
        'Consultation des demandes de collecte et de livraison, localisation sur carte Google Maps, confirmation de collecte et suivi des livraisons.',
    },
    {
      role: 'Comptable',
      scope: 'Toutes les boutiques (ou 1 boutique)',
      keyActions:
        "Tableau de bord, comptabilité, journaux des dépôts et règlements, relevés clients, gestion complète des dépenses et catégories, versements de commissions aux apporteurs d'affaire, et consultation des clients, de l'inventaire et des consommables.",
    },
    {
      role: 'Associé (Consultation)',
      scope: 'Toutes les boutiques (ou 1 boutique)',
      keyActions:
        "Consultation et impression uniquement : tableau de bord, planning, historique, journaux, comptabilité, dépenses, apporteurs d'affaire, relevés, clients, catalogue, inventaire, consommables et boutiques — aucune création, modification ou suppression.",
    },
  ];
}

export function getTechnicalSpecs(lang: Lang): Array<[string, string]> {
  if (lang === 'en') {
    return [
      ['Application type', 'Progressive Web App (PWA) — Android, iOS, Windows, macOS'],
      ['Connectivity', 'Online & guaranteed offline mode (IndexedDB + auto sync queue)'],
      ['Synchronization', 'Real-time multi-device sync via Supabase'],
      ['Client search engine', 'In-memory indexed search (< 1 ms for 4,000+ clients)'],
      ['Receipts & labels', 'A5 sheet, 80/100 mm thermal ticket, garment labels & WhatsApp'],
      ['Numbering', 'Annual format (D-001-YYYY), per-store counter & terminal prefixes'],
      ['Dedicated portals', 'Client Portal (QR code) & Partner Portal (access code)'],
      ['Mapping & alerts', 'Google Maps pickup/delivery view & Web Push notifications'],
      ['Data protection', 'Company-scoped Row-Level Security (RLS) & role permissions'],
      ['Update resilience', 'Deferred PWA updates + local draft auto-save during deposits'],
    ];
  }

  return [
    ['Plateforme', 'Application Web Progressive (PWA) — Android, iOS, Windows, macOS'],
    ['Connectivité', 'En ligne et hors-ligne garanti (IndexedDB + file de synchronisation)'],
    ['Synchronisation', 'Temps réel multi-appareils via Supabase'],
    ['Recherche clients', 'Indexée en mémoire (< 1 ms pour plus de 4 000 clients)'],
    ['Impressions & partage', 'Format A5, ticket thermique 80/100 mm, étiquettes et WhatsApp'],
    ['Numérotation', 'Annuelle (D-001-AAAA), compteur par boutique et préfixe multi-postes'],
    ['Portails dédiés', "Portail Client (QR Code) et Portail Apporteur d'affaire (code personnel)"],
    ['Cartographie & alertes', 'Google Maps (collecte/livraison) et notifications Push temps réel'],
    ['Sécurité', 'Authentification sécurisée, rôles et isolation RLS par entreprise'],
    ['Continuité de caisse', 'Mises à jour différées + sauvegarde auto du brouillon de dépôt'],
  ];
}

export function getUserGuideChapters(lang: Lang): GuideChapter[] {
  if (lang === 'en') {
    return [
      {
        number: '01',
        id: 'getting-started',
        title: 'Getting Started & Installation',
        subtitle: 'Sign in, install the app, and choose your store',
        summary:
          'PressingLite works in any modern browser and can be installed directly onto your phone, tablet, or counter computer for offline-ready daily work.',
        sections: [
          {
            heading: 'Signing in and joining your company',
            steps: [
              'Open the application URL and sign in with your email address and password.',
              'New companies can register directly to receive an automatic 30-day Demo license while awaiting Super Admin validation.',
              'Team members joining an existing pressing can submit a join request with the exact company name or ask their Administrator to create their account under "Team".',
            ],
          },
          {
            heading: 'Installing as a desktop or mobile app (PWA)',
            steps: [
              'On Android or Desktop (Chrome/Edge): click "Install App" in the sidebar or browser bar and confirm.',
              'On iPhone/iPad (Safari): tap the Share icon, then choose "Add to Home Screen".',
              'Once installed, the app opens full-screen, caches your data locally, and stays usable even during Internet outages.',
            ],
            tip: 'Use the store switcher at the top of the sidebar (for multi-store Administrators) to switch between branches cleanly.',
          },
        ],
      },
      {
        number: '02',
        id: 'initial-setup',
        title: 'Initial Company & Catalog Setup',
        subtitle: 'Company profile, stores, items, treatments, and payment methods',
        summary:
          'Before recording your first deposits, configure your business identity, catalog prices, treatment multipliers, and accepted payment methods.',
        sections: [
          {
            heading: 'Company profile & receipt branding',
            steps: [
              'Open "Company" in the Administration menu to enter your business name, phone, phone prefix, address, city, slogan, receipt footer message, and logo.',
              'Configure your loyalty points rate (points earned per 1,000 currency units) and garment label fields.',
              'In "Stores", create additional storefronts if needed. Each store can have its own receipt header, GPS coordinates, and starting deposit counter.',
            ],
          },
          {
            heading: 'Item catalog, treatment types & payment methods',
            steps: [
              'Open "Catalog" to add your articles with unit price, default piece count, and optional pricing variants (e.g., delicate fabric, silk).',
              'Define your treatment types (Normal with coefficient 1 and default turnaround days, Express, Next-Day Express, etc.).',
              'Open "Payment Methods" to configure Cash, Mobile Money, Card, Bank Transfer, and optional payment-method discounts.',
            ],
            tip: 'You can bulk-import existing clients and catalog items directly from an Excel spreadsheet.',
          },
        ],
      },
      {
        number: '03',
        id: 'deposits',
        title: 'Recording a Deposit Step by Step',
        subtitle: '3-step front-desk workflow, printing, and WhatsApp sharing',
        summary:
          'The Deposit form guides cashiers through Client selection, Item entry, and Payment in seconds — with built-in protection against accidental loss.',
        sections: [
          {
            heading: 'Step 1 — Selecting or creating a client',
            steps: [
              'Click "New deposit" in the Operations menu.',
              'Type a client name, phone number, or client code: results appear instantaneously even with 4,000+ clients.',
              'If the client is new, click "New client", enter their name and phone, and their code is generated automatically.',
            ],
          },
          {
            heading: 'Step 2 — Adding items & treatment type',
            steps: [
              'The "Normal" treatment type is preselected by default. Change it if the customer requests Express or another treatment — prices and pickup date update automatically.',
              'Select items from the catalog (or add a new item inline), adjust quantity, piece count, color, brand, and special remarks.',
              'Review the automatic pickup date or override it if the customer requests a specific date.',
            ],
          },
          {
            heading: 'Step 3 — Payment, referral partner, printing & WhatsApp',
            steps: [
              'If the client is linked to a referral partner within an active period, that partner is automatically preselected with live commission calculation (you can also select or change the partner manually).',
              'Enter the deposit payment. You can split a single deposit across multiple payment methods (e.g., Cash + Mobile Money), and client discounts or promo coupons apply automatically.',
              'Click "Validate deposit". On the confirmation screen, print an A5 receipt or 80/100 mm thermal ticket (showing the logged-in operator name at the bottom), print garment labels, or send the formatted receipt via WhatsApp in one click.',
            ],
            tip: 'Your in-progress deposit is automatically saved locally as a draft, and software updates are deferred until you finish or leave the deposit.',
          },
        ],
      },
      {
        number: '04',
        id: 'pickups-workshop',
        title: 'Pickups, Treatment Edits & Workshop Tracking',
        subtitle: 'Partial or full handover, balance collection, schedule, and inventory',
        summary:
          'Manage daily garment handovers cleanly while keeping full traceability over balances and workshop status.',
        sections: [
          {
            heading: 'Processing a pickup',
            steps: [
              'Open "Pickup" and search by deposit number, client name, or phone.',
              'Check off individual items for a partial pickup, or select all items for a full handover.',
              'If a balance remains due, record the final payment directly before confirming pickup and reprinting the settled receipt.',
            ],
          },
          {
            heading: 'Modifying the treatment type of a validated deposit',
            steps: [
              'From Pickup, History, or Deposit Journal, click the edit treatment action on a validated deposit.',
              'Choose the new treatment type (e.g., switching from Normal to Express).',
              'The software automatically recalculates item prices, total amount, balance due, and expected pickup date.',
            ],
          },
          {
            heading: 'Schedule, History & Workshop Inventory',
            bullets: [
              'Schedule: calendar overview of deposits and upcoming pickup deadlines.',
              'History: complete searchable archive of all deposits (in progress, picked up, or cancelled).',
              'Inventory: real-time count of all garments currently held inside the workshop.',
            ],
          },
        ],
      },
      {
        number: '05',
        id: 'clients-loyalty',
        title: 'Clients, Loyalty, Coupons & Statements',
        subtitle: 'Customer retention, normalized codes, and account statements',
        summary:
          'Build long-term customer relationships with standardized client codes, automated discount rules, promo vouchers, and printable statements.',
        sections: [
          {
            heading: 'Managing your client directory',
            steps: [
              'Open "Clients" to search, edit, or import clients from Excel.',
              'Set a custom discount rate and minimum spend threshold per client (automatically applied to Normal deposits).',
              'Use "Normalize client codes" when needed to align all client codes with your store prefix.',
            ],
          },
          {
            heading: 'Promo coupons & client statements',
            bullets: [
              'Coupons: create percentage or fixed-amount promo codes with validity dates and maximum usage limits.',
              'Loyalty points: earned automatically on every deposit and visible on the Client Portal.',
              'Account Statement: select any client and date range to view all deposits, payments, and remaining balance, then print A4 or share via WhatsApp.',
            ],
          },
        ],
      },
      {
        number: '06',
        id: 'sales-agents',
        title: 'Referral Partners, Commissions & Partner Portal',
        subtitle: 'Multi-client period assignments, payouts, and code-based portal',
        summary:
          'Reward business introducers and referral partners transparently with automated commissions across all invoices of their linked clients.',
        sections: [
          {
            heading: 'Creating referral partners & linking clients over a period',
            steps: [
              'Open "Referral Partners" (Tracking & Finance) and click "New partner" to enter their name, contact details, and default commission rate (%).',
              'Click "Link clients", select the referral partner, pick one or more clients, set the start date and duration in days (15, 30, 60, 90, 180, 365 days or custom), and confirm.',
              'Every non-cancelled invoice for those clients within the active period automatically earns commission (with an optional per-client custom rate). You can also assign a partner directly during deposit Step 3 or on any existing invoice.',
            ],
          },
          {
            heading: 'Recording payouts & sharing the Partner Portal',
            steps: [
              'Click "Pay" next to a referral partner to record a commission payout (amount, payment method, period covered, reference) and optionally log it as a company expense.',
              'Click the key icon next to a partner to copy their personal portal code (COM-XXXXXXXX) and direct Partner Portal link, or send it via WhatsApp.',
              'The referral partner opens the Partner Portal (also accessible from the sign-in screen), enters their code, and views their KPIs, linked clients with days remaining, commissioned invoices, and payout history.',
            ],
            tip: 'Referral partners do not need a staff account. You can regenerate a partner portal code at any time to immediately revoke the previous code.',
          },
        ],
      },
      {
        number: '07',
        id: 'portals-logistics',
        title: 'Client Portal, Online Orders, Pickup & Delivery',
        subtitle: 'QR code self-service and Google Maps field runs',
        summary:
          'Let customers follow their laundry online and request door-to-door pickup or delivery directly from their phone.',
        sections: [
          {
            heading: 'Sharing the Client Portal',
            steps: [
              'From the Company page, print your QR Code flyer or copy your Client Portal link.',
              'Customers log in using their phone number or portal code to check garment status, loyalty points, and place online orders.',
            ],
          },
          {
            heading: 'Managing Orders, Pickups & Deliveries on Google Maps',
            steps: [
              'Incoming online orders trigger an audio alert and Web Push notification so staff never miss a request.',
              'Open "Orders", "Pickup Runs", or "Delivery Runs" to view customer locations on the interactive Google Map and confirm collection or delivery in real time.',
            ],
          },
        ],
      },
      {
        number: '08',
        id: 'finance-stock',
        title: 'Accounting, Journals, Expenses & Consumables',
        subtitle: 'Daily cash control, expense categories, and supply stock',
        summary:
          'Keep exact daily control over revenue, cash drawers, operating expenses, and pressing supplies.',
        sections: [
          {
            heading: 'Daily financial tracking',
            bullets: [
              'Dashboard: real-time overview of deposits, collections, pending pickups, and revenue trends.',
              'Deposit Journal & Payment Journal: filter by date range or payment method and print paginated A4 reports.',
              'Expenses: record rent, electricity, detergent purchases, or salaries by category to monitor net results in Accounting.',
            ],
          },
          {
            heading: 'Consumables inventory',
            steps: [
              'Open "Consumables" to list your supplies (detergent, starch, hangers, garment bags) with unit and minimum alert threshold.',
              'Record stock entries and exits to keep quantities accurate and spot low-stock alerts early.',
            ],
          },
        ],
      },
      {
        number: '09',
        id: 'team-multistore',
        title: 'Team Management, Roles & Multi-Store Control',
        subtitle: 'Permissions, billing terminals, and deposit counters',
        summary:
          'Scale safely across multiple employees and storefronts with clear accountability on every receipt.',
        sections: [
          {
            heading: 'Managing users & accountability',
            steps: [
              'Open "Team" (Admin only) to create team members, assign their role (Admin, Manager, Sales/Cashier, Collector, Accountant, or Associate read-only), and assign them to a specific store (or all stores for Accountant and Associate).',
              'Approve or reject pending join requests directly from the Team page.',
              'The logged-in user\'s full name is printed automatically in the footer of every receipt for clear cash-desk traceability.',
            ],
          },
          {
            heading: 'Billing points & independent starting counters',
            steps: [
              'If multiple computers work offline in the same store, assign a unique short Billing Point prefix (e.g., C1, C2) on each terminal in the "New deposit" screen to guarantee collision-free numbers.',
              'Administrators and Managers can set a custom starting deposit number per store for the current year.',
            ],
          },
        ],
      },
      {
        number: '10',
        id: 'offline-troubleshooting',
        title: 'Offline Mode, Synchronization & Quick Troubleshooting',
        subtitle: 'Working without Internet and resolving common situations',
        summary:
          'PressingLite is engineered to keep your counter running smoothly even when Internet connectivity drops.',
        sections: [
          {
            heading: 'Working offline & syncing automatically',
            steps: [
              'Before an expected outage (or regularly), open the sync status panel in the sidebar to confirm your offline cache is warm.',
              'If Internet drops, keep recording deposits, clients, and payments normally — every operation is safely queued in local storage.',
              'As soon as connectivity returns, queued mutations synchronize automatically in the background.',
            ],
          },
          {
            heading: 'Quick troubleshooting checklist',
            bullets: [
              'Update banner during a deposit: do not worry — updates automatically wait until your deposit is finished and never erase your entries.',
              'Thermal ticket printing: verify your browser print dialog has margins set to "None" and paper width matched to 80/100 mm.',
              'Forgot or change password: use the key icon in the sidebar footer to update your password at any time.',
              'Need support? Contact AGASOFT technical assistance at 225 010 220 2062.',
            ],
          },
        ],
      },
    ];
  }

  return [
    {
      number: '01',
      id: 'demarrage',
      title: 'Prise en main & Installation',
      subtitle: 'Connexion, installation de l\'application (PWA) et choix de la boutique',
      summary:
        'PressingLite fonctionne sur ordinateur, tablette et smartphone, et s\'installe directement comme une application native pour un usage fluide en ligne et hors ligne.',
      sections: [
        {
          heading: 'Connexion et rattachement à votre entreprise',
          steps: [
            'Ouvrez l\'adresse du logiciel puis connectez-vous avec votre adresse email et votre mot de passe.',
            'Lors de la création d\'une nouvelle entreprise, une licence Démo de 30 jours est préparée automatiquement dès l\'inscription.',
            'Pour intégrer une équipe existante, envoyez une demande d\'adhésion avec le nom exact de l\'entreprise ou demandez à l\'Administrateur de créer votre compte dans le menu « Équipe ».',
          ],
        },
        {
          heading: 'Installer le logiciel sur mobile ou ordinateur (PWA)',
          steps: [
            'Sur Android ou ordinateur (Chrome / Edge) : cliquez sur « Installer l\'application » dans le menu latéral puis confirmez.',
            'Sur iPhone / iPad (Safari) : appuyez sur le bouton Partager puis sélectionnez « Sur l\'écran d\'accueil ».',
            'Une fois installée, l\'application s\'ouvre en plein écran, conserve vos données en cache local et reste utilisable sans connexion Internet.',
          ],
          tip: 'Si votre entreprise gère plusieurs agences, l\'Administrateur peut basculer d\'une boutique à l\'autre via le sélecteur en haut du menu latéral.',
        },
      ],
    },
    {
      number: '02',
      id: 'configuration',
      title: 'Configuration initiale du pressing',
      subtitle: 'Entreprise, boutiques, catalogue d\'articles, traitements et règlements',
      summary:
        'Avant d\'enregistrer vos premiers dépôts, renseignez les informations de votre pressing, vos tarifs et vos règles de facturation.',
      sections: [
        {
          heading: 'Paramétrer l\'entreprise et les boutiques',
          steps: [
            'Ouvrez « Entreprise » dans la section Administration : renseignez le nom, le téléphone, l\'indicatif téléphonique, l\'adresse, la ville, le slogan, le message en pied de reçu et le logo.',
            'Définissez le barème de points fidélité (points attribués par tranche de 1 000 FCFA) et les champs à afficher sur les étiquettes vêtements.',
            'Dans « Boutiques », ajoutez vos différentes agences : chacune dispose de son propre en-tête de reçu, de sa position GPS et de son compteur de départ.',
          ],
        },
        {
          heading: 'Constituer le catalogue, les traitements et les modes de règlement',
          steps: [
            'Dans « Catalogue », enregistrez vos articles avec leur prix unitaire, leur nombre de pièces par défaut et, si besoin, des variantes tarifaires (soie, costume délicat, etc.).',
            'Configurez vos types de traitement (Normal avec coefficient 1, Express, Express lendemain...) en précisant le coefficient multiplicateur et le délai en jours.',
            'Dans « Modes de règlement », ajoutez Espèces, Mobile Money, Carte bancaire, Virement, ainsi que d\'éventuelles remises associées à un mode.',
          ],
          tip: 'Vous pouvez importer rapidement votre base clients ou votre catalogue existant depuis un fichier Excel.',
        },
      ],
    },
    {
      number: '03',
      id: 'depots',
      title: 'Enregistrer un dépôt pas à pas',
      subtitle: 'Parcours en 3 étapes, impression A5/ticket, étiquettes et WhatsApp',
      summary:
        'Le formulaire de Dépôt est conçu pour la rapidité au comptoir : recherche instantanée, calculs automatiques et protection totale contre les interruptions.',
      sections: [
        {
          heading: 'Étape 1 — Choisir ou créer le client',
          steps: [
            'Ouvrez « Nouveau dépôt » dans le menu Opérations.',
            'Saisissez le nom, le téléphone ou le code client : la recherche indexée répond instantanément, même avec plus de 4 000 clients.',
            'Pour un nouveau client, cliquez sur « Nouveau client », saisissez son nom et son numéro : son code unique est généré automatiquement.',
          ],
        },
        {
          heading: 'Étape 2 — Saisir les articles et le type de traitement',
          steps: [
            'Le type de traitement « Normal » est sélectionné par défaut. Si le client choisit un autre traitement (ex. Express), tous les prix et la date de retrait prévue se recalculent instantanément.',
            'Sélectionnez vos articles dans le catalogue (ou créez un article directement à la volée), puis ajustez quantité, nombre de pièces, couleur, griffe et signe particulier.',
            'Vérifiez la date de retrait prévue ou modifiez-la manuellement en cas de demande spécifique du client.',
          ],
        },
        {
          heading: "Étape 3 — Apporteur d'affaire, paiement, impression et WhatsApp",
          steps: [
            "Si le client est rattaché à un apporteur d'affaire sur une période active, celui-ci est présélectionné automatiquement avec aperçu de la commission (vous pouvez aussi en choisir ou modifier un manuellement).",
            'Saisissez l\'avance ou le règlement complet (multi-modes possible via « Ajouter un mode »). Les remises clients automatiques et bons de réduction s\'appliquent directement sur le total.',
            'Cliquez sur « Valider le dépôt ». Depuis l\'écran de confirmation, imprimez le reçu A5 ou le ticket thermique 80/100 mm (avec le nom de l\'utilisateur connecté en pied de reçu), imprimez les étiquettes vêtements ou envoyez le reçu par WhatsApp en 1 clic.',
          ],
          tip: 'Tout dépôt en cours est sauvegardé automatiquement en brouillon local et les mises à jour du logiciel patientent jusqu\'à la fin du dépôt : aucune saisie ne peut être perdue.',
        },
      ],
    },
    {
      number: '04',
      id: 'retraits-atelier',
      title: 'Retraits, modification de traitement & atelier',
      subtitle: 'Remise partielle ou totale, solde, planning et inventaire',
      summary:
        'Suivez précisément les vêtements en traitement, encaissez les soldes à la remise et adaptez les dépôts validés sans erreur.',
      sections: [
        {
          heading: 'Effectuer un retrait client',
          steps: [
            'Ouvrez « Retrait » et recherchez le dépôt par numéro, nom du client ou téléphone.',
            'Cochez les articles remis un par un (retrait partiel) ou sélectionnez l\'ensemble du dépôt (retrait total).',
            'Si un solde reste à payer, enregistrez le règlement complémentaire avant de confirmer le retrait puis réimprimez le reçu soldé si nécessaire.',
          ],
        },
        {
          heading: 'Modifier le type de traitement d\'un dépôt validé',
          steps: [
            'Depuis Retrait, Historique ou le Journal des dépôts, cliquez sur l\'action de modification du traitement sur le dépôt concerné.',
            'Sélectionnez le nouveau type de traitement souhaité (ex. passage de Normal à Express).',
            'Le logiciel recalcule automatiquement les prix unitaires, le total de la facture, le reste à payer et la date de retrait prévue.',
          ],
        },
        {
          heading: 'Planning, Historique & Inventaire atelier',
          bullets: [
            'Planning : vue calendrier de tous les dépôts et des échéances de retrait à venir.',
            'Historique : archives complètes et filtrables de tous les dépôts (en cours, retirés ou annulés).',
            'Inventaire : état instantané de toutes les pièces physiquement présentes en atelier.',
          ],
        },
      ],
    },
    {
      number: '05',
      id: 'clients-fidelite',
      title: 'Clients, fidélité, bons de réduction & relevés',
      subtitle: 'Base clients, codes normalisés, remises et relevés de compte',
      summary:
        'Organisez votre fichier clients avec des codes propres à chaque agence et fidélisez votre clientèle automatiquement.',
      sections: [
        {
          heading: 'Gérer votre fichier clients',
          steps: [
            'Ouvrez « Clients » pour consulter, modifier ou importer votre fichier clients depuis Excel.',
            'Attribuez à un client un taux de remise et un montant minimum (appliqués automatiquement sur les dépôts en traitement Normal).',
            'Utilisez l\'outil de normalisation des codes clients pour harmoniser les préfixes de vos fiches avec le code de votre boutique.',
          ],
        },
        {
          heading: 'Bons de réduction, fidélité & relevé client',
          bullets: [
            'Bons de réduction : créez des codes promo en pourcentage ou en montant fixe, avec dates de validité et nombre d\'utilisations maximum.',
            'Points de fidélité : crédités automatiquement à chaque dépôt et consultables par le client sur son portail.',
            'Relevé client : sélectionnez un client et une période pour éditer son relevé complet (factures, avances, solde), l\'imprimer en A4 ou l\'envoyer par WhatsApp.',
          ],
        },
      ],
    },
    {
      number: '06',
      id: 'commerciaux-portail',
      title: "Apporteurs d'affaire, commissions & Portail dédié",
      subtitle: 'Rattachement multi-clients sur durée en jours, versements et suivi par code',
      summary:
        "Développez votre chiffre d'affaires avec des apporteurs d'affaire rémunérés à la commission sur toutes les factures de leurs clients durant une période définie.",
      sections: [
        {
          heading: "Créer un apporteur d'affaire et lier ses clients sur une durée",
          steps: [
            "Ouvrez « Apporteurs d'affaire » dans Suivi & Finances, puis cliquez sur « Nouvel apporteur d'affaire » en indiquant son nom, son contact et son taux de commission (%).",
            "Cliquez sur « Lier des clients », sélectionnez l'apporteur d'affaire, cochez un ou plusieurs clients, choisissez la date de début et la durée en jours (15, 30, 60, 90, 180, 365 jours ou durée libre), puis cliquez sur « Lier ».",
            "Toutes les factures non annulées de ces clients sur la période active génèrent automatiquement une commission (avec possibilité de prolonger ou définir un taux spécifique par client). Vous pouvez aussi associer un apporteur d'affaire directement lors d'un dépôt ou depuis l'onglet « Factures & Dépôts ».",
          ],
        },
        {
          heading: "Verser les commissions et partager le Portail Apporteur d'affaire",
          steps: [
            "Cliquez sur « Verser » sur la ligne d'un apporteur d'affaire pour enregistrer un paiement (montant, mode de règlement, période couverte, référence) et, si souhaité, l'inscrire directement en dépense.",
            "Cliquez sur l'icône Clé pour consulter et copier le code personnel de l'apporteur d'affaire (format COM-XXXXXXXX), copier le lien direct du Portail Apporteur d'affaire ou l'envoyer par WhatsApp.",
            "L'apporteur d'affaire ouvre le Portail Apporteur d'affaire (également accessible depuis l'écran de connexion), saisit son code et consulte en temps réel ses clients liés, les jours restants, ses factures commissionnées et ses versements.",
          ],
          tip: "Un apporteur d'affaire n'a pas besoin de compte employé : son code personnel suffit. En cas de perte ou de départ, vous pouvez régénérer un nouveau code portail à tout moment pour révoquer immédiatement l'ancien.",
        },
      ],
    },
    {
      number: '07',
      id: 'portail-client-logistique',
      title: 'Portail Client, Commandes, Collecte & Livraison',
      subtitle: 'Suivi client par QR Code et tournées sur carte Google Maps',
      summary:
        'Offrez à vos clients un suivi autonome depuis leur téléphone et pilotez vos collecteurs et livreurs sur le terrain.',
      sections: [
        {
          heading: 'Activer et partager le Portail Client',
          steps: [
            'Depuis la page « Entreprise », imprimez l\'affiche QR Code pour votre comptoir ou copiez le lien direct du Portail Client.',
            'Vos clients s\'identifient avec leur téléphone ou code personnel pour consulter l\'état de leurs dépôts, leurs points fidélité et passer une commande en ligne.',
          ],
        },
        {
          heading: 'Piloter les commandes, collectes et livraisons',
          steps: [
            'Chaque nouvelle commande ou demande de collecte déclenche une alerte sonore et une notification Push en temps réel.',
            'Ouvrez « Commandes », « Linge à collecter » ou « Commandes à livrer » pour visualiser les adresses des clients sur la carte Google Maps et valider chaque étape terrain.',
          ],
        },
      ],
    },
    {
      number: '08',
      id: 'finances-stock',
      title: 'Comptabilité, journaux, dépenses & consommables',
      subtitle: 'Contrôle de caisse quotidien, charges et stock d\'atelier',
      summary:
        'Gardez une vision claire et immédiate de votre rentabilité, de votre trésorerie et de vos fournitures d\'atelier.',
      sections: [
        {
          heading: 'Journaux et suivi financier',
          bullets: [
            'Tableau de bord : indicateurs clés du jour et du mois, dépôts en cours, encaissements et tendances.',
            'Journal des dépôts & Journal des règlements : filtres par période et mode de paiement avec impression de rapports A4 paginés.',
            'Dépenses & Comptabilité : saisissez vos charges par catégorie (loyer, électricité, produits, salaires, commissions) pour suivre votre résultat net.',
          ],
        },
        {
          heading: 'Suivi des consommables',
          steps: [
            'Ouvrez « Consommables » pour référencer vos produits (lessive, détachants, cintres, housses) avec leur seuil d\'alerte minimum.',
            'Enregistrez vos entrées et sorties de stock afin d\'anticiper vos réapprovisionnements avant toute rupture.',
          ],
        },
      ],
    },
    {
      number: '09',
      id: 'equipe-multiboutiques',
      title: 'Équipe, rôles & gestion multi-boutiques',
      subtitle: 'Droits d\'accès, traçabilité des reçus et compteurs indépendants',
      summary:
        'Structurez votre organisation avec des autorisations adaptées à chaque poste et une gestion propre à chaque agence.',
      sections: [
        {
          heading: 'Utilisateurs, rôles et traçabilité',
          steps: [
            'Ouvrez « Équipe » (réservé à l\'Administrateur) pour créer les comptes de votre équipe, définir leur rôle (Administrateur, Gérant, Commercial/Caissier, Collecteur, Comptable ou Associé en consultation) et les affecter à une boutique (ou à toutes les boutiques pour le Comptable et l\'Associé).',
            'Validez ou refusez en un clic les demandes d\'adhésion reçues.',
            'Le nom complet de l\'utilisateur connecté s\'affiche automatiquement en pied de chaque reçu imprimé pour une traçabilité claire de la caisse.',
          ],
        },
        {
          heading: 'Points de facturation & compteurs de départ',
          steps: [
            'Si plusieurs postes travaillent simultanément hors ligne dans la même boutique, attribuez un court préfixe de Point de facturation (ex. C1, C2) depuis l\'écran « Nouveau dépôt » pour éviter tout doublon de numéro.',
            'Les Administrateurs et Gérants peuvent configurer le numéro de départ annuel des dépôts indépendamment pour chaque boutique.',
          ],
        },
      ],
    },
    {
      number: '10',
      id: 'hors-ligne-depannage',
      title: 'Mode hors-ligne, synchronisation & dépannage',
      subtitle: 'Continuité d\'activité sans Internet et réponses aux questions fréquentes',
      summary:
        'PressingLite est conçu pour assurer une continuité totale au comptoir, même lorsque la connexion Internet est instable ou absente.',
      sections: [
        {
          heading: 'Travailler hors ligne et synchroniser',
          steps: [
            'Vérifiez régulièrement le panneau de synchronisation dans le menu latéral pour vous assurer que les données locales sont à jour.',
            'En cas de coupure Internet, continuez vos dépôts, créations de clients et encaissements normalement : tout est enregistré dans la file locale sécurisée.',
            'Dès le retour de la connexion, les opérations en attente se synchronisent automatiquement en arrière-plan.',
          ],
        },
        {
          heading: 'Réflexes utiles & assistance',
          bullets: [
            'Mise à jour pendant un dépôt : le bandeau discret vous indique que la mise à jour patiente automatiquement jusqu\'à la fin de votre dépôt en cours.',
            'Impression thermique 80/100 mm : dans la fenêtre d\'impression du navigateur, sélectionnez Marges = Aucune et désactivez les en-têtes/pieds de page du navigateur.',
            'Changement de mot de passe : cliquez sur l\'icône Clé en bas du menu latéral pour modifier votre mot de passe à tout moment.',
            'Assistance technique AGASOFT : contactez le support au 225 010 220 2062.',
          ],
        },
      ],
    },
  ];
}
