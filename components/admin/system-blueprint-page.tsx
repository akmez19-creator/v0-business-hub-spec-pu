'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Boxes, ChevronRight, Compass, Database, Download, GitBranch, Layers3, Map as MapIcon, Search, ShieldCheck, Sparkles, Truck, Users, Wallet, X, Zap } from 'lucide-react'

const catalog = {
  "schemaVersion": 1,
  "title": "Akmez Verified Live Catalog",
  "description": "Descriptive architecture and workflow data from the production UI audit, reconciled with the downloaded current source. This catalog contains no executable operations.",
  "evidence": {
    "sourceDocument": "work/live-feature-audit.md",
    "observedOn": "2026-09-11",
    "site": "https://www.akmez.tech",
    "method": "Read-only production UI audit from an administrator view, followed by targeted current-source review of routes, role identifiers and selected workflow conditions.",
    "limits": [
      "Visible controls do not prove successful backend execution.",
      "No role impersonation or permission-enforcement tests were performed.",
      "Module grouping and role involvement are editorial descriptions, not access-control rules.",
      "Workflow handoffs are labeled and are not executable state machines.",
      "No customer rows, account values, secrets, personal contact details, financial identifiers or precise locations are included.",
      "No live metric totals, schema-table counts or API-handler totals are asserted.",
      "Source review establishes implementation intent, not successful production execution or deployed database migration state."
    ],
    "sourceRoot": "work/current-source",
    "sourceReconciledOn": "2026-09-11",
    "rawCatalogSha256": "BBD8647983084A3ABED4122B3802F54A6D067159FC63FC42A9B774EB78D8833F"
  },
  "evidenceStatuses": [
    {
      "id": "observed-ui",
      "label": "Interface observed",
      "meaning": "A feature, control, state or relationship was visible in the audited production UI; execution may be untested."
    },
    {
      "id": "planned",
      "label": "Coming Soon",
      "meaning": "The production page explicitly identifies the capability as a future update."
    },
    {
      "id": "documented-only",
      "label": "Documentation only",
      "meaning": "Behavior is described in the app's documentation/release notes and was not executed or verified against source."
    },
    {
      "id": "link-observed",
      "label": "Linked route",
      "meaning": "A link was visible; the destination was not independently inspected."
    },
    {
      "id": "source-reviewed",
      "label": "Source reviewed",
      "meaning": "The condition or behavior is present in the downloaded current source. It was not executed in production; database scripts are not proof of applied migrations."
    }
  ],
  "rolesMeaning": "Actors and likely involvement only. Never render these associations as verified page permissions, capability grants or authorization rules.",
  "workflowMeaning": "An explanatory graph joining observed modules. Each edge distinguishes interface evidence, source-reviewed conditions and conceptual handoffs; it is not an executable state machine.",
  "groups": [
    {
      "id": "demand",
      "name": "Demand & Customers",
      "purpose": "Campaigns, product context, conversations and customer history.",
      "moduleIds": [
        "customer-inbox",
        "product-master",
        "advertising",
        "client-history",
        "public-storefront"
      ]
    },
    {
      "id": "operations",
      "name": "Delivery Operations",
      "purpose": "Business activity, delivery records, exceptions and geographic coverage.",
      "moduleIds": [
        "business-overview",
        "delivery-operations",
        "cms-recovery",
        "territory-planning"
      ]
    },
    {
      "id": "stock",
      "name": "Stock & Warehouse",
      "purpose": "Catalog quantities, rider stock and physical-count review.",
      "moduleIds": [
        "inventory-catalog",
        "rider-stock",
        "warehouse-counts"
      ]
    },
    {
      "id": "procurement",
      "name": "Purchasing",
      "purpose": "Import evidence, supplier relationships, reorder proposals and actual purchases.",
      "moduleIds": [
        "imports",
        "foreign-suppliers",
        "china-reorders",
        "local-supplier-orders",
        "local-purchases"
      ]
    },
    {
      "id": "money",
      "name": "Money & Records",
      "purpose": "Customer collection, contractor payout, payroll and the planned deduction module.",
      "moduleIds": [
        "customer-collections",
        "contractor-payouts",
        "payroll",
        "deductions"
      ]
    },
    {
      "id": "people",
      "name": "People & Schedules",
      "purpose": "Rider/contractor relationships and staff shifts.",
      "moduleIds": [
        "logistics-team",
        "staff-schedules"
      ]
    },
    {
      "id": "administration",
      "name": "Administration & Tools",
      "purpose": "Account configuration, company settings and documented companion tools.",
      "moduleIds": [
        "administration",
        "extensions-guide"
      ]
    }
  ],
  "modules": [
    {
      "id": "business-overview",
      "groupId": "operations",
      "name": "Overview & Entry Activity",
      "purpose": "Understand business activity and when agents enter orders.",
      "routes": [
        "/dashboard",
        "/dashboard/activity"
      ],
      "inputs": [
        "Delivery records",
        "Client records",
        "Agent entry timestamps"
      ],
      "outputs": [
        "Operational summaries",
        "Monthly activity calendar",
        "Clients-served versus orders-typed view",
        "Hourly activity in Mauritius time"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "The interface summarizes stored business activity; refresh cadence and metric formulas were not verified.",
        "trigger": null,
        "visibleStates": []
      },
      "humanBoundary": "Interpret totals within each screen's date and record scope. Entry spans are not independently verified attendance.",
      "features": [
        "Delivery summary",
        "Recent assignments",
        "Agent filters",
        "Daily calendar",
        "Busiest day",
        "Peak hour",
        "Typical entry span"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard",
          "sourcePath": "app/dashboard/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/activity",
          "sourcePath": "app/dashboard/activity/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "customer-inbox",
      "groupId": "demand",
      "name": "Unified Inbox",
      "purpose": "Bring page-linked conversations and leads into one workspace.",
      "routes": [
        "/dashboard/inbox"
      ],
      "inputs": [
        "Messenger leads",
        "WhatsApp leads",
        "Facebook comments",
        "Product and campaign links"
      ],
      "outputs": [
        "Waiting and action-needed lead views",
        "Product and campaign filters",
        "Conversation-to-order workspace"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office"
      ],
      "automation": {
        "mode": "source-reviewed-assistance",
        "summary": "Current source requests a suggested reply and order fields when a selected lead has readable content. Sending a reply and creating an order remain separate user actions. Live generation was not exercised.",
        "trigger": "A selected lead has a comment snippet or loaded messages and differs from the last assisted lead; Redraft explicitly requests another suggestion.",
        "visibleStates": [
          "Waiting",
          "Needs action"
        ],
        "sourceRefs": [
          "components/inbox/leads-channel.tsx:205",
          "components/inbox/leads-channel.tsx:274",
          "components/inbox/leads-channel.tsx:284",
          "components/inbox/leads-channel.tsx:542"
        ]
      },
      "humanBoundary": "Assistance may run after selecting a lead. Review the suggested reply and order fields; sending and order submission require their own actions. Production execution and role permissions were not tested.",
      "features": [
        "Messenger",
        "WhatsApp",
        "Comments",
        "Live ads filter",
        "Search",
        "Product filter",
        "Campaign filter",
        "WhatsApp setup"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/inbox",
          "sourcePath": "app/dashboard/inbox/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "product-master",
      "groupId": "demand",
      "name": "Product Master",
      "purpose": "Connect product availability, demand, procurement and creative work.",
      "routes": [
        "/dashboard/product-master"
      ],
      "inputs": [
        "Catalog stock",
        "Active ads",
        "Recent client activity",
        "Open purchase orders",
        "Post library"
      ],
      "outputs": [
        "Unified product view",
        "Stock and demand signals",
        "Links to inventory and purchasing",
        "Creative-tool entry points"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office",
        "storekeeper"
      ],
      "automation": {
        "mode": "controls-observed",
        "summary": "AI Merge, Studio, Poster and Manage Posts are exposed. No merge or generation was initiated.",
        "trigger": null,
        "visibleStates": [
          "Sold out",
          "Low stock",
          "In stock",
          "Has open PO",
          "Advertised"
        ]
      },
      "humanBoundary": "Creative generation and catalog merging require deliberate actions. The audit did not verify their side effects.",
      "features": [
        "Clients today and last seven days",
        "Open POs",
        "Posts",
        "Stock",
        "Active ads",
        "Low-stock threshold filter"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/product-master",
          "sourcePath": "app/dashboard/product-master/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "advertising",
      "groupId": "demand",
      "name": "Ads Manager",
      "purpose": "Relate campaign spending and recent edits to products and client activity.",
      "routes": [
        "/dashboard/ads"
      ],
      "inputs": [
        "Facebook campaign data",
        "Product links",
        "Client activity",
        "Recent Facebook edits"
      ],
      "outputs": [
        "Spend by account and product",
        "Estimated cost per client",
        "Message cost",
        "Budget remaining",
        "Edit watch state"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent"
      ],
      "automation": {
        "mode": "state-observed",
        "summary": "The UI shows recent budget changes, watch-window status and freshness. Automatic budget changes were not demonstrated.",
        "trigger": "A recorded campaign budget edit is displayed in the watch view",
        "visibleStates": [
          "EDITED TODAY",
          "EDITED – WATCHING",
          "Not improving",
          "ACTIVE"
        ]
      },
      "humanBoundary": "Watch labels support review; they do not establish that the app edits budgets automatically. Account and date scope remain visible.",
      "features": [
        "MUR and USD spend",
        "Account filters",
        "Date filter",
        "TV Mode",
        "Group by Product",
        "Active versus with-spend campaigns",
        "Recent Edits",
        "Campaign end date"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/ads",
          "sourcePath": "app/dashboard/ads/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "client-history",
      "groupId": "demand",
      "name": "Client History",
      "purpose": "Review customer delivery history and the ratings displayed from it.",
      "routes": [
        "/dashboard/clients"
      ],
      "inputs": [
        "Historical client records",
        "Orders",
        "Delivery outcomes",
        "Sales amounts"
      ],
      "outputs": [
        "Delivery-history ratings",
        "Order count",
        "Delivered percentage",
        "Total sales",
        "Last-order view"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "The page states ratings are based on delivery history. Exact thresholds and rating-refresh rules were not verified.",
        "trigger": null,
        "visibleStates": [
          "Good",
          "Average",
          "Bad"
        ]
      },
      "humanBoundary": "Treat ratings as contextual history. The audit did not verify automatic customer restrictions or role-specific access.",
      "features": [
        "Rating filter",
        "Sales sort",
        "Past-data import",
        "Add Client"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/clients",
          "sourcePath": "app/dashboard/clients/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "delivery-operations",
      "groupId": "operations",
      "name": "Delivery Operations",
      "purpose": "Manage delivery records and inspect delivery performance.",
      "routes": [
        "/dashboard/deliveries",
        "/dashboard/deliveries/all"
      ],
      "inputs": [
        "Client and product entries",
        "Quantity and amount",
        "Entry and delivery dates",
        "Locality and route",
        "Agent, rider and contractor references"
      ],
      "outputs": [
        "Delivery register",
        "Status views",
        "Assignment controls",
        "Performance summaries",
        "Import and export interfaces"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "controls-observed",
        "summary": "Assignment, status and reconciliation controls are visible. Status-transition enforcement and downstream writes were not exercised.",
        "trigger": null,
        "visibleStates": [
          "Pending",
          "Assigned",
          "Picked Up",
          "Delivered",
          "NWD",
          "CMS"
        ]
      },
      "humanBoundary": "Statuses are observed options, not a verified transition sequence. Assigning, updating or reconciling records requires a deliberate operational action.",
      "features": [
        "Daily, weekly, monthly and quarterly analytics",
        "Separate entry-date and delivery-date filters",
        "Rider and region filters",
        "Excel import/export",
        "Reconcile Month",
        "Sales type",
        "Payment",
        "Medium"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries",
          "sourcePath": "app/dashboard/deliveries/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/deliveries/all",
          "sourcePath": "app/dashboard/deliveries/all/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "cms-recovery",
      "groupId": "operations",
      "name": "CMS & Exception Review",
      "purpose": "Review Could Not Serve deliveries and refused stock remaining on vans.",
      "routes": [
        "/dashboard/admin/cms"
      ],
      "inputs": [
        "Postponed deliveries",
        "Failed deliveries",
        "Price-review requests",
        "NWD van stock"
      ],
      "outputs": [
        "Validation queue",
        "Failure-review queue",
        "Price-approval queue",
        "Confirmed new-day view",
        "Reviewed references"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "state-observed",
        "summary": "Review queues and actions are visible. The UI warns some unvalidated postponements already steer the delivery round.",
        "trigger": null,
        "visibleStates": [
          "Postponed, not yet confirmed",
          "Failed, no decision yet",
          "Pending approval",
          "Confirmed for a new day",
          "Reviewed",
          "On vans (NWD)"
        ]
      },
      "humanBoundary": "Validate confirms the proposed day; Change day chooses another day; Reject undoes the postponement. Review and approval actions were not executed.",
      "features": [
        "Could Not Serve",
        "Validate",
        "Change day",
        "Reject",
        "Reschedule",
        "Carried-over stock"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/admin/cms",
          "sourcePath": "app/dashboard/admin/cms/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "logistics-team",
      "groupId": "people",
      "name": "Riders & Contractors",
      "purpose": "Connect logistics personnel, contractor teams and settlement context.",
      "routes": [
        "/dashboard/deliveries/riders",
        "/dashboard/deliveries/contractors",
        "/dashboard/admin/team"
      ],
      "inputs": [
        "Rider profiles",
        "Contractor relationships",
        "Account links",
        "Delivery outcomes",
        "Compensation settings"
      ],
      "outputs": [
        "Contractor-to-rider hierarchy",
        "Delivery-rate views",
        "Linked-account state",
        "Earnings and settlement summaries"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Performance and settlement summaries are displayed. Their calculation and synchronization logic were not independently verified.",
        "trigger": null,
        "visibleStates": [
          "Linked",
          "Not Linked",
          "Settled"
        ]
      },
      "humanBoundary": "Editing personnel, assignment or compensation is separate from viewing summaries. Account values are excluded from this catalog.",
      "features": [
        "Rating sort",
        "Contractor filter",
        "View Riders",
        "Per-delivery rates",
        "Fixed monthly salary",
        "Prior/current-month summary"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/riders",
          "sourcePath": "app/dashboard/deliveries/riders/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/deliveries/contractors",
          "sourcePath": "app/dashboard/deliveries/contractors/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/admin/team",
          "sourcePath": "app/dashboard/admin/team/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "customer-collections",
      "groupId": "money",
      "name": "Customer Collections",
      "purpose": "Track customer payments due and received.",
      "routes": [
        "/dashboard/deliveries/collections"
      ],
      "inputs": [
        "Delivery amounts",
        "Recorded customer payments",
        "Payment method",
        "Rider reference",
        "Date scope"
      ],
      "outputs": [
        "Collected, due and remaining amounts",
        "Per-rider collection view",
        "Payment-state filters"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Payment-state and total views are exposed; automatic settlement or payment-provider synchronization was not verified.",
        "trigger": null,
        "visibleStates": [
          "Unpaid",
          "Partial",
          "Paid"
        ]
      },
      "humanBoundary": "Updating customer payment details is a financial record action. This module is distinct from contractor payouts.",
      "features": [
        "Juice",
        "Cash",
        "Internet Banking",
        "Date filter",
        "Per-rider totals"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/collections",
          "sourcePath": "app/dashboard/deliveries/collections/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "contractor-payouts",
      "groupId": "money",
      "name": "Contractor Payouts",
      "purpose": "Review contractor earnings, withdrawals and recorded payouts.",
      "routes": [
        "/dashboard/deliveries/payments"
      ],
      "inputs": [
        "Contractor rates",
        "Delivery counts",
        "Recorded earnings",
        "Withdrawals",
        "Payout records"
      ],
      "outputs": [
        "Last/current-month earnings",
        "Paid-out and owed balances",
        "Withdrawal view",
        "Payout history"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor"
      ],
      "automation": {
        "mode": "controls-observed",
        "summary": "Record payout is exposed alongside balance views. No payout or money movement was performed.",
        "trigger": null,
        "visibleStates": [
          "Owed",
          "Settled"
        ]
      },
      "humanBoundary": "A displayed balance is not a payment. Record payout and withdrawal handling remain distinct deliberate actions.",
      "features": [
        "Contractors tab",
        "Withdrawals tab",
        "Payout History tab",
        "Rate and rider columns",
        "Paid versus owed"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/payments",
          "sourcePath": "app/dashboard/deliveries/payments/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "payroll",
      "groupId": "money",
      "name": "Payroll",
      "purpose": "Prepare employee payslips from payroll profiles and monthly periods.",
      "routes": [
        "/dashboard/deliveries/payroll"
      ],
      "inputs": [
        "Salaried employee records",
        "Payroll profiles",
        "Selected month",
        "Statutory deduction data"
      ],
      "outputs": [
        "Profile-completion view",
        "Payslip status",
        "Individual and batch generation controls",
        "Letter controls"
      ],
      "roles": [
        "admin",
        "manager"
      ],
      "automation": {
        "mode": "controls-observed",
        "summary": "Individual and batch payslip-generation controls are visible, but generation and calculation were not tested.",
        "trigger": null,
        "visibleStates": [
          "No Profile",
          "Profile Set"
        ]
      },
      "humanBoundary": "A payroll profile is required for the displayed batch generation flow. Payslip generation is separate from paying an employee.",
      "features": [
        "Monthly period selector",
        "Generate All",
        "Individual Generate",
        "Letter"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/payroll",
          "sourcePath": "app/dashboard/deliveries/payroll/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "deductions",
      "groupId": "money",
      "name": "Deductions",
      "purpose": "Planned administration of missing stock, cash shortages and damages.",
      "routes": [
        "/dashboard/admin/deductions"
      ],
      "inputs": [
        "Planned contractor/rider deduction cases"
      ],
      "outputs": [
        "Coming Soon information"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "planned",
        "summary": "The page explicitly says this capability will be available in a future update.",
        "trigger": null,
        "visibleStates": [
          "Coming Soon"
        ]
      },
      "humanBoundary": "No operational deduction workflow was present in the audited interface.",
      "features": [
        "Missing stock",
        "Cash shortfalls",
        "Damages"
      ],
      "evidenceStatus": "planned",
      "routeVerification": [
        {
          "route": "/dashboard/admin/deductions",
          "sourcePath": "app/dashboard/admin/deductions/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "inventory-catalog",
      "groupId": "stock",
      "name": "Inventory & Pricing",
      "purpose": "Manage product identity, pricing and distinct stock quantities.",
      "routes": [
        "/dashboard/deliveries/inventory"
      ],
      "inputs": [
        "Product catalog",
        "Initial stock batches",
        "In-store stock",
        "China stock",
        "Undelivered products",
        "Pricing and shelf locations"
      ],
      "outputs": [
        "Catalog views",
        "Pricing tiers and bundle labels",
        "Stock-confidence states",
        "Product-match warnings",
        "Shelf-zone references"
      ],
      "roles": [
        "admin",
        "manager",
        "storekeeper",
        "marketing-agent"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Stock views distinguish physically verified figures from uncounted quantities; unmatched undelivered rows are flagged. Formula implementation was not inspected.",
        "trigger": null,
        "visibleStates": [
          "Active",
          "Low stock",
          "To Count",
          "Uncounted",
          "Physically verified"
        ]
      },
      "humanBoundary": "Uncounted is not known zero. Combining products, setting shelves and importing stock are deliberate actions not exercised in the audit.",
      "features": [
        "Table and grid",
        "Categories",
        "Initial batches",
        "In Store",
        "In China",
        "Undelivered",
        "Actual",
        "B1G1",
        "Bundles",
        "Find Duplicates",
        "Combine Two"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/inventory",
          "sourcePath": "app/dashboard/deliveries/inventory/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "rider-stock",
      "groupId": "stock",
      "name": "Rider Stock",
      "purpose": "Inspect daily product movement and stock held by riders.",
      "routes": [
        "/dashboard/deliveries/stock"
      ],
      "inputs": [
        "Rider reference",
        "Selected date",
        "Opening stock",
        "Received stock",
        "Delivery and return records"
      ],
      "outputs": [
        "Daily stock balances",
        "Stock-movement view",
        "In-transit and exception quantities"
      ],
      "roles": [
        "admin",
        "manager",
        "storekeeper",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Daily stock and movement tables are visible. Automatic posting from deliveries was not verified.",
        "trigger": null,
        "visibleStates": [
          "In Transit",
          "Delivered",
          "Returns",
          "Defective"
        ]
      },
      "humanBoundary": "Stock edits and movement corrections require an explicit action; the catalog does not assert automatic ledger posting.",
      "features": [
        "Opening",
        "Received",
        "In Transit",
        "Delivered",
        "Returns",
        "Defective",
        "Closing",
        "Daily Stock",
        "Stock Movements"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/stock",
          "sourcePath": "app/dashboard/deliveries/stock/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "warehouse-counts",
      "groupId": "stock",
      "name": "Warehouse Counts",
      "purpose": "Review physical count batches and their variances.",
      "routes": [
        "/dashboard/deliveries/stock-counts"
      ],
      "inputs": [
        "Warehouse count batches",
        "Product and unit counts",
        "First-count markers",
        "Variance quantities"
      ],
      "outputs": [
        "Count-review history",
        "Approval state",
        "Positive and negative variance"
      ],
      "roles": [
        "admin",
        "manager",
        "storekeeper"
      ],
      "automation": {
        "mode": "review-state-observed",
        "summary": "The current server action calls a stock-count approval function after an admin check. The included SQL requires a submitted count and writes counted product quantities; production execution and applied migration state were not verified.",
        "trigger": null,
        "visibleStates": [
          "Approved"
        ],
        "sourceRefs": [
          "lib/stock-count-actions.ts:51",
          "lib/stock-count-actions.ts:488",
          "scripts/create-stock-counts.sql:103"
        ]
      },
      "humanBoundary": "Uncounted is not zero. Count submission and approval are separate actions; the reviewed source limits approval to an admin. This is not a complete permission audit.",
      "features": [
        "Batch history",
        "First counts",
        "Product totals",
        "Unit totals",
        "Variance"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/deliveries/stock-counts",
          "sourcePath": "app/dashboard/deliveries/stock-counts/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "imports",
      "groupId": "procurement",
      "name": "China Imports",
      "purpose": "Track imported products, supplier costs and shipment information.",
      "routes": [
        "/dashboard/purchasing"
      ],
      "inputs": [
        "Import references",
        "Supplier details",
        "Product matches",
        "Quantities",
        "Pricing and discounts",
        "Logistics data"
      ],
      "outputs": [
        "Import history",
        "Supplier costs",
        "Landed cost view",
        "Inventory-match references",
        "Tracking view"
      ],
      "roles": [
        "admin",
        "manager",
        "storekeeper"
      ],
      "automation": {
        "mode": "controls-observed",
        "summary": "New reorder and spreadsheet import/export controls are exposed. Shipment synchronization and inventory posting were not demonstrated.",
        "trigger": null,
        "visibleStates": [
          "Message Sent",
          "pending",
          "Negotiate Shipping",
          "Received"
        ]
      },
      "humanBoundary": "An import record, supplier payment and stock receipt are separate concepts. The audit did not establish automatic transfers between them.",
      "features": [
        "Overview",
        "Pricing",
        "Logistics",
        "All columns",
        "Unit prices",
        "Supplier payment",
        "Weight",
        "Volume",
        "Landed cost",
        "Tracking"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/purchasing",
          "sourcePath": "app/dashboard/purchasing/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "foreign-suppliers",
      "groupId": "procurement",
      "name": "Foreign Suppliers",
      "purpose": "Connect supplier history, quality notes and product sourcing.",
      "routes": [
        "/dashboard/purchasing/suppliers"
      ],
      "inputs": [
        "Supplier references",
        "Import history",
        "1688 rating fields",
        "Internal quality notes",
        "Product and conversation references"
      ],
      "outputs": [
        "Supplier catalog",
        "Dated quality context",
        "Spend and quantity summaries",
        "Filtered import history"
      ],
      "roles": [
        "admin",
        "manager"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Supplier-name navigation filters the import history. Rating checks or external synchronization were not invoked.",
        "trigger": null,
        "visibleStates": [
          "Not checked",
          "Not rated",
          "Received"
        ]
      },
      "humanBoundary": "External platform ratings and internal quality notes are distinct evidence. No supplier communication or evaluation was submitted.",
      "features": [
        "1688 rating",
        "Internal rating",
        "Dated quality notes",
        "MUR and CNY spend",
        "Landed cost",
        "Conversations",
        "Last import"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/purchasing/suppliers",
          "sourcePath": "app/dashboard/purchasing/suppliers/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "china-reorders",
      "groupId": "procurement",
      "name": "China Reorder Research",
      "purpose": "Research reorder candidates while preserving evidence, budgets and review boundaries.",
      "routes": [
        "/dashboard/purchasing/reorders"
      ],
      "inputs": [
        "Reorder interest list",
        "Quantity and price assumptions",
        "Prior import evidence",
        "1688 listing references"
      ],
      "outputs": [
        "Saved research findings",
        "Variant-verification state",
        "Attempt and reservation budgets",
        "Candidate proposals",
        "Reviewed import handoff"
      ],
      "roles": [
        "admin",
        "manager"
      ],
      "automation": {
        "mode": "background-state-observed",
        "summary": "Started checks continue in the background. The page states that opening, selecting or restoring it does not make paid calls.",
        "trigger": "A person explicitly starts or resumes a 1688 check",
        "visibleStates": [
          "Partial findings saved",
          "Current listing not available",
          "Needs variant confirmation",
          "Verifying variants",
          "Credit or connection needs attention"
        ]
      },
      "humanBoundary": "Research and replacements are proposals. A separate final confirmation records a new import; possible matches are not verified savings.",
      "features": [
        "TMAPI and AI attempts",
        "Reserved and remaining allowance",
        "Saved timestamp",
        "Resume / retry",
        "Start fresh",
        "Unverified-evidence notes",
        "CNY and MUR totals"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/purchasing/reorders",
          "sourcePath": "app/dashboard/purchasing/reorders/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "local-supplier-orders",
      "groupId": "procurement",
      "name": "Local Supplier Orders",
      "purpose": "Maintain supplier-facing reorder revisions separately from purchases.",
      "routes": [
        "/dashboard/purchasing/local/orders"
      ],
      "inputs": [
        "Supplier product names and codes",
        "Order lines",
        "Revision",
        "Issued estimate",
        "Supplier response"
      ],
      "outputs": [
        "Draft and issued orders",
        "Revision history references",
        "Response comparison",
        "Handoff to actual-purchase recording"
      ],
      "roles": [
        "admin",
        "manager"
      ],
      "automation": {
        "mode": "ui-described",
        "summary": "The UI describes comparing the supplier response before acceptance. No issue, acceptance or import action was performed.",
        "trigger": null,
        "visibleStates": [
          "draft",
          "issued"
        ]
      },
      "humanBoundary": "Drafting, issuing and accepting supplier confirmation do not record a purchase, post stock or record payment.",
      "features": [
        "Order/revision",
        "Find an order",
        "Status filter",
        "Last issued estimate",
        "Order detail links"
      ],
      "evidenceStatus": "observed-ui",
      "relatedRoutes": [
        {
          "path": "/dashboard/purchasing/local/orders/new",
          "evidenceStatus": "link-observed"
        },
        {
          "path": "/dashboard/purchasing/local/orders/[id]",
          "evidenceStatus": "link-observed"
        }
      ],
      "routeVerification": [
        {
          "route": "/dashboard/purchasing/local/orders",
          "sourcePath": "app/dashboard/purchasing/local/orders/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/purchasing/local/orders/new",
          "sourcePath": "app/dashboard/purchasing/local/orders/new/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/purchasing/local/orders/[id]",
          "sourcePath": "app/dashboard/purchasing/local/orders/[id]/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "local-purchases",
      "groupId": "procurement",
      "name": "Local Purchase Recording",
      "purpose": "Record an actual local purchase with product matching and cost comparison.",
      "routes": [
        "/dashboard/purchasing/local"
      ],
      "inputs": [
        "Receipt or invoice document",
        "Supplier and reference",
        "Printed line prices",
        "Quantity, discount and VAT",
        "Import-cost and stock context"
      ],
      "outputs": [
        "Proposed matched lines",
        "Cost comparisons",
        "Arithmetic exceptions",
        "Explicit actual-purchase record"
      ],
      "roles": [
        "admin",
        "manager",
        "storekeeper"
      ],
      "automation": {
        "mode": "ui-described",
        "summary": "The interface describes document parsing and automatic product matching, with unclear matches raised for review. No document was uploaded or parsed.",
        "trigger": "A person chooses a document or explicitly checks the lines against imports",
        "visibleStates": [
          "Actual-purchase acknowledgment required",
          "Exceptions require explanation"
        ]
      },
      "humanBoundary": "Actual purchase must be acknowledged. Exception reasoning is tied to the current figures and revision; changed figures need fresh acknowledgment.",
      "features": [
        "Photo",
        "PDF",
        "WhatsApp screenshot",
        "Excel/CSV",
        "Check against imports",
        "Printed discount",
        "VAT",
        "Save purchase"
      ],
      "evidenceStatus": "observed-ui",
      "relatedRoutes": [
        {
          "path": "/dashboard/purchasing/local/history",
          "evidenceStatus": "link-observed"
        }
      ],
      "routeVerification": [
        {
          "route": "/dashboard/purchasing/local",
          "sourcePath": "app/dashboard/purchasing/local/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/purchasing/local/history",
          "sourcePath": "app/dashboard/purchasing/local/history/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "staff-schedules",
      "groupId": "people",
      "name": "Staff & Timetable",
      "purpose": "Connect employee and contractor records with weekly shifts.",
      "routes": [
        "/dashboard/admin/executives",
        "/dashboard/admin/timetable"
      ],
      "inputs": [
        "Executive and contractor records",
        "Departments",
        "Schedules",
        "Selected week"
      ],
      "outputs": [
        "Staff views",
        "Weekly timetable",
        "Working-now and scheduled-today indicators",
        "Leave view"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider",
        "storekeeper",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office"
      ],
      "automation": {
        "mode": "derived-view",
        "summary": "Schedule-based indicators are visible. Recurrence, attendance integration and automatic shift changes were not tested.",
        "trigger": null,
        "visibleStates": [
          "Active",
          "Working Now",
          "Scheduled Today",
          "On Leave"
        ]
      },
      "humanBoundary": "Adding shifts or editing schedules is separate from observing attendance-like indicators. Staff totals are scoped by screen.",
      "features": [
        "Executive and contractor tabs",
        "Weekly view",
        "Staff filter",
        "Add Shift",
        "Edit Schedules"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/admin/executives",
          "sourcePath": "app/dashboard/admin/executives/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/admin/timetable",
          "sourcePath": "app/dashboard/admin/timetable/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "territory-planning",
      "groupId": "operations",
      "name": "Regions & Day Placement",
      "purpose": "Combine permanent locality coverage with reviewed changes for a single day.",
      "routes": [
        "/dashboard/admin/regions",
        "/dashboard/admin/placement"
      ],
      "inputs": [
        "Regions and localities",
        "Contractor/rider relationships",
        "Standing coverage plan",
        "Selected delivery date",
        "Order locations",
        "Map-position quality"
      ],
      "outputs": [
        "Standing coverage",
        "Day-specific deviations",
        "Unassigned-order view",
        "Rider targets",
        "Reviewed placement plan"
      ],
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "automation": {
        "mode": "ui-described",
        "summary": "Source resolves explicit riders first, then a contractor with one active rider; unresolved choices remain visible. Day exceptions override standing coverage, and explicit validation applies riders to eligible open orders.",
        "trigger": null,
        "visibleStates": [
          "Standing",
          "Moved for this day",
          "Nobody assigned",
          "Real position",
          "Estimated",
          "District-only estimate"
        ],
        "sourceRefs": [
          "lib/placement/effective.ts:143",
          "lib/placement/effective.ts:190",
          "lib/placement-actions.ts:216"
        ]
      },
      "humanBoundary": "Daily placement changes need validation. Estimated map points must not be treated as exact positions; no map or assignment change was made.",
      "features": [
        "Placement Plans",
        "Copy a past day",
        "Zone gaps",
        "Rider Targets",
        "Mapbox map",
        "Permanent versus one-day coverage"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/admin/regions",
          "sourcePath": "app/dashboard/admin/regions/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/admin/placement",
          "sourcePath": "app/dashboard/admin/placement/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "administration",
      "groupId": "administration",
      "name": "Accounts & Company Settings",
      "purpose": "Define account roles and shared company/document settings.",
      "routes": [
        "/dashboard/admin/users",
        "/dashboard/admin/settings"
      ],
      "inputs": [
        "Account records",
        "Role and status labels",
        "Company information",
        "VAT settings",
        "Warehouse pickup configuration",
        "Module setting"
      ],
      "outputs": [
        "Account-management interface",
        "Company-document defaults",
        "Warehouse pickup context",
        "Orders-module visibility setting"
      ],
      "roles": [
        "admin"
      ],
      "automation": {
        "mode": "configuration-observed",
        "summary": "The UI states company settings appear on invoices, payslips and client-facing pages, and the Orders setting controls contractor/rider tab visibility.",
        "trigger": null,
        "visibleStates": [
          "Role and status filters",
          "Orders module setting"
        ]
      },
      "humanBoundary": "Role names are observed; permission enforcement was not tested. Settings and account controls were inspected without saving or exposing values.",
      "features": [
        "Create User",
        "Eight role labels",
        "VAT-inclusive invoice setting",
        "Official stamp",
        "Warehouse location",
        "Orders module"
      ],
      "evidenceStatus": "observed-ui",
      "routeVerification": [
        {
          "route": "/dashboard/admin/users",
          "sourcePath": "app/dashboard/admin/users/page.tsx",
          "pageExists": true
        },
        {
          "route": "/dashboard/admin/settings",
          "sourcePath": "app/dashboard/admin/settings/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "extensions-guide",
      "groupId": "administration",
      "name": "Extensions & Akmez Guide",
      "purpose": "Describe companion tools that support order entry and contextual assistance.",
      "routes": [
        "/dashboard/tools"
      ],
      "inputs": [
        "Tools-page documentation",
        "On-page release notes",
        "Visible Guide panel tabs"
      ],
      "outputs": [
        "Extension entry points",
        "Documented workflow capabilities",
        "Contextual-help interface"
      ],
      "roles": [
        "admin",
        "manager",
        "marketing-agent",
        "marketing-back-office",
        "marketing-front-office"
      ],
      "automation": {
        "mode": "documented-only",
        "summary": "Release notes describe AI reply drafting, Ad ID/product matching, delivery-date rules and order/document behavior. Their execution was not tested.",
        "trigger": null,
        "visibleStates": [
          "Chat",
          "History",
          "Guide"
        ]
      },
      "humanBoundary": "Documented extension claims require current-source verification before being presented as implemented automation. Reply drafting is described separately from human sending.",
      "features": [
        "Quick Order Extension",
        "Akmez Guide",
        "Chat / History / Guide",
        "1688 translation and listing capture descriptions"
      ],
      "evidenceStatus": "documented-only",
      "routeVerification": [
        {
          "route": "/dashboard/tools",
          "sourcePath": "app/dashboard/tools/page.tsx",
          "pageExists": true
        }
      ]
    },
    {
      "id": "public-storefront",
      "groupId": "demand",
      "name": "Public Storefront",
      "purpose": "Let customers browse the catalogue and submit a delivery order without a staff account.",
      "routes": [
        "/shop",
        "/shop/search",
        "/shop/deals",
        "/shop/checkout"
      ],
      "inputs": [
        "Active product catalogue",
        "Basket product IDs and quantities",
        "Customer contact and delivery locality",
        "Current stock and pricing rules"
      ],
      "outputs": [
        "Product and deal browsing",
        "Server-calculated order amount",
        "Pending delivery entries marked WEB",
        "Order reference after a successful save"
      ],
      "roles": [],
      "actors": [
        "Customer without a staff account"
      ],
      "automation": {
        "mode": "source-reviewed-after-submit",
        "summary": "On checkout submission, the server validates locality and current availability, calculates prices, and saves pending delivery entries. No payment gateway charge occurs in this handler.",
        "trigger": "Customer deliberately submits checkout",
        "visibleStates": [
          "Unavailable item",
          "Insufficient stock",
          "Quote required",
          "Order accepted"
        ],
        "sourceRefs": [
          "app/api/shop/order/route.ts:47",
          "app/api/shop/order/route.ts:66",
          "app/api/shop/order/route.ts:95",
          "app/api/shop/order/route.ts:114",
          "app/api/shop/order/route.ts:152"
        ]
      },
      "humanBoundary": "Customer submission creates an order. Delivery completion and payment recording remain later steps. The audit did not submit an order or charge a payment.",
      "features": [
        "Catalogue",
        "Search",
        "Deals",
        "Product details",
        "Category browsing",
        "Basket and checkout"
      ],
      "evidenceStatus": "source-reviewed",
      "relatedRoutes": [
        {
          "path": "/shop/category/[category]",
          "evidenceStatus": "source-reviewed"
        },
        {
          "path": "/shop/p/[id]",
          "evidenceStatus": "source-reviewed"
        }
      ],
      "routeVerification": [
        {
          "route": "/shop",
          "sourcePath": "app/shop/page.tsx",
          "pageExists": true
        },
        {
          "route": "/shop/search",
          "sourcePath": "app/shop/search/page.tsx",
          "pageExists": true
        },
        {
          "route": "/shop/deals",
          "sourcePath": "app/shop/deals/page.tsx",
          "pageExists": true
        },
        {
          "route": "/shop/checkout",
          "sourcePath": "app/shop/checkout/page.tsx",
          "pageExists": true
        },
        {
          "route": "/shop/category/[category]",
          "sourcePath": "app/shop/category/[category]/page.tsx",
          "pageExists": true
        },
        {
          "route": "/shop/p/[id]",
          "sourcePath": "app/shop/p/[id]/page.tsx",
          "pageExists": true
        }
      ]
    }
  ],
  "workflows": [
    {
      "id": "lead-to-collection",
      "name": "Lead to Collection",
      "purpose": "Show how demand, customer contact, delivery and customer money relate.",
      "evidenceStatus": "observed-modules-conceptual-handoffs",
      "roles": [
        "marketing-agent",
        "marketing-front-office",
        "marketing-back-office",
        "manager",
        "contractor",
        "rider",
        "admin"
      ],
      "nodes": [
        {
          "id": "campaign",
          "label": "Campaign and product context",
          "moduleId": "advertising",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "lead",
          "label": "Lead needs attention",
          "moduleId": "customer-inbox",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "history",
          "label": "Review client history",
          "moduleId": "client-history",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "order",
          "label": "Create or review delivery entry",
          "moduleId": "delivery-operations",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "dispatch",
          "label": "Assignment and delivery-status controls",
          "moduleId": "delivery-operations",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "exception",
          "label": "CMS or NWD exception",
          "moduleId": "cms-recovery",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "collection",
          "label": "Record customer collection",
          "moduleId": "customer-collections",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "balance",
          "label": "Unpaid, partial or paid view",
          "moduleId": "customer-collections",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        }
      ],
      "edges": [
        {
          "from": "campaign",
          "to": "lead",
          "condition": "Linked product/campaign lead appears",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "lead",
          "to": "history",
          "condition": "Past-customer context is useful",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "history",
          "to": "order",
          "condition": "Proceed with an order",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "lead",
          "to": "order",
          "condition": "Person submits the order after required customer, locality, product and business fields are present",
          "evidenceStatus": "source-reviewed",
          "note": "Assistance prefills draft fields; the Create order action performs submission. This path was inspected, not executed.",
          "sourceRefs": [
            "components/inbox/quick-order-panel.tsx:145",
            "components/inbox/quick-order-panel.tsx:152",
            "components/inbox/quick-order-panel.tsx:413"
          ]
        },
        {
          "from": "order",
          "to": "dispatch",
          "condition": "Delivery enters operations",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "dispatch",
          "to": "exception",
          "condition": "Service or stock exception needs review",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "dispatch",
          "to": "collection",
          "condition": "Customer payment is recorded",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "collection",
          "to": "balance",
          "condition": "Recorded payment is summarized",
          "evidenceStatus": "observed-ui",
          "note": null
        }
      ],
      "humanBoundary": "Suggested replies may be generated after a lead opens. Sending, order submission, delivery assignment and payment recording remain separate human actions.",
      "caveat": "The diagram connects observed modules; it is not a verified backend state machine. Delivery status options do not prove allowed transitions."
    },
    {
      "id": "china-reorder-research",
      "name": "China Reorder Research",
      "purpose": "Separate evidence gathering from committing a new import.",
      "evidenceStatus": "ui-described-with-saved-states",
      "roles": [
        "admin",
        "manager"
      ],
      "nodes": [
        {
          "id": "history",
          "label": "Prior imports and supplier evidence",
          "moduleId": "imports",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "interest",
          "label": "Choose reorder candidates and quantities",
          "moduleId": "china-reorders",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "start",
          "label": "Explicitly start or resume research",
          "moduleId": "china-reorders",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "research",
          "label": "Research continues in background",
          "moduleId": "china-reorders",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "gap",
          "label": "Listing or variant evidence incomplete",
          "moduleId": "china-reorders",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "blocked",
          "label": "Credit or connection needs attention",
          "moduleId": "china-reorders",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "proposal",
          "label": "Review saved candidate proposal",
          "moduleId": "china-reorders",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "confirm",
          "label": "Separate final confirmation records import",
          "moduleId": "imports",
          "kind": "human-action",
          "evidenceStatus": "ui-described"
        }
      ],
      "edges": [
        {
          "from": "history",
          "to": "interest",
          "condition": "Use prior import evidence",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "interest",
          "to": "start",
          "condition": "Person requests a check",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "start",
          "to": "research",
          "condition": "Accepted research is claimed by its background workflow",
          "evidenceStatus": "source-reviewed",
          "note": "The workflow advances owned jobs; each stage must obtain its reservation before paid execution.",
          "sourceRefs": [
            "workflows/reorder-1688.ts:4",
            "workflows/reorder-1688.ts:28",
            "lib/purchase-orders/1688-queue.ts:118"
          ]
        },
        {
          "from": "research",
          "to": "gap",
          "condition": "Listing unavailable or variant unverified",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "gap",
          "to": "proposal",
          "condition": "Keep incomplete evidence clearly labeled",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "research",
          "to": "blocked",
          "condition": "Credit or connection problem stops undispatched paid work",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "blocked",
          "to": "start",
          "condition": "Person explicitly resumes interrupted research or retries an unacknowledged background start",
          "evidenceStatus": "source-reviewed",
          "note": "Saved product and research revisions must still match. Changed evidence requires an explicit fresh check; background interruption does not automatically retry paid work.",
          "sourceRefs": [
            "lib/purchase-orders/1688-queue.ts:35",
            "lib/purchase-orders/1688-queue.ts:48",
            "lib/purchase-orders/1688-queue.ts:148"
          ]
        },
        {
          "from": "research",
          "to": "proposal",
          "condition": "Saved research is ready for review",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "proposal",
          "to": "confirm",
          "condition": "Person confirms a new import separately",
          "evidenceStatus": "ui-described",
          "note": null
        }
      ],
      "humanBoundary": "Opening the page does not initiate paid research. Research is a proposal; no supplier purchase or stock posting is implied.",
      "caveat": "Possible matches are not verified savings, and an unavailable listing does not prove that its supplier stopped trading."
    },
    {
      "id": "local-purchase",
      "name": "Local Order to Actual Purchase",
      "purpose": "Keep supplier quotations and orders distinct from actual purchases.",
      "evidenceStatus": "ui-described-with-observed-controls",
      "roles": [
        "admin",
        "manager",
        "storekeeper"
      ],
      "nodes": [
        {
          "id": "draft",
          "label": "Draft a supplier order and revision",
          "moduleId": "local-supplier-orders",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "issued",
          "label": "Issued estimate",
          "moduleId": "local-supplier-orders",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "response",
          "label": "Compare supplier response",
          "moduleId": "local-supplier-orders",
          "kind": "human-action",
          "evidenceStatus": "ui-described"
        },
        {
          "id": "document",
          "label": "Enter or import actual purchase document",
          "moduleId": "local-purchases",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "match",
          "label": "Review product matches and cost comparison",
          "moduleId": "local-purchases",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "exception",
          "label": "Unclear match or arithmetic exception",
          "moduleId": "local-purchases",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "ack",
          "label": "Acknowledge actual purchase and current figures",
          "moduleId": "local-purchases",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "save",
          "label": "Save actual purchase record",
          "moduleId": "local-purchases",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        }
      ],
      "edges": [
        {
          "from": "draft",
          "to": "issued",
          "condition": "Person issues a revision with complete quantities, expected prices and VAT terms",
          "evidenceStatus": "source-reviewed",
          "note": "The source rejects issuing when the price calculation cannot be recorded.",
          "sourceRefs": [
            "lib/local-purchasing/order-service.ts:130",
            "lib/local-purchasing/order-service.ts:140"
          ]
        },
        {
          "from": "issued",
          "to": "response",
          "condition": "Supplier response is available",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "response",
          "to": "document",
          "condition": "An actual purchase has occurred",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "document",
          "to": "match",
          "condition": "Lines are entered or proposed from a document",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "match",
          "to": "exception",
          "condition": "Unclear products or differences need attention",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "exception",
          "to": "ack",
          "condition": "Resolve essential errors and explain accepted differences for the current review",
          "evidenceStatus": "source-reviewed",
          "note": "The server requires a specific reason of at least eight characters when an exception applies; an explanation does not bypass unresolved price treatment.",
          "sourceRefs": [
            "lib/local-purchasing/purchase-service.ts:85",
            "lib/local-purchasing/purchase-service.ts:104",
            "lib/local-purchasing/order-service.ts:226"
          ]
        },
        {
          "from": "match",
          "to": "ack",
          "condition": "Figures are understood",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "ack",
          "to": "save",
          "condition": "Actual purchase is confirmed and the current document and review remain valid",
          "evidenceStatus": "source-reviewed",
          "note": "Save rejects stale or already-recorded source documents. Required exception reasons must match the current review revision.",
          "sourceRefs": [
            "components/local-purchasing/purchase-entry.tsx:1049",
            "components/local-purchasing/purchase-entry.tsx:1051",
            "lib/local-purchasing/purchase-service.ts:86",
            "lib/local-purchasing/purchase-service.ts:92",
            "lib/local-purchasing/order-service.ts:237"
          ]
        },
        {
          "from": "ack",
          "to": "match",
          "condition": "Figures, product decisions or source review change after acknowledgement",
          "evidenceStatus": "source-reviewed",
          "note": "Reload stale evidence and review again; a reason attached to an old review revision is not accepted.",
          "sourceRefs": [
            "components/local-purchasing/purchase-acknowledgement.tsx:20",
            "lib/local-purchasing/purchase-service.ts:86",
            "lib/local-purchasing/purchase-service.ts:93"
          ]
        }
      ],
      "humanBoundary": "Drafting, issuing or accepting a supplier confirmation does not record a purchase, post stock or record payment.",
      "caveat": "Document parsing and saving were not exercised. The workflow does not claim automatic inventory or payment posting."
    },
    {
      "id": "cms-recovery",
      "name": "Delivery Exception Recovery",
      "purpose": "Make separate exception queues and review decisions understandable.",
      "evidenceStatus": "ui-described-with-observed-queues",
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "nodes": [
        {
          "id": "exception",
          "label": "Could Not Serve or NWD case",
          "moduleId": "cms-recovery",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "postpone",
          "label": "Postponement awaits validation",
          "moduleId": "cms-recovery",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "failed",
          "label": "Failed delivery awaits decision",
          "moduleId": "cms-recovery",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "price",
          "label": "Price change awaits approval",
          "moduleId": "cms-recovery",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "van",
          "label": "Refused stock remains on van",
          "moduleId": "cms-recovery",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "validate",
          "label": "Validate proposed day or choose another",
          "moduleId": "cms-recovery",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "reject",
          "label": "Reject and restore original date",
          "moduleId": "cms-recovery",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "flow",
          "label": "Delivery flow on the recorded day",
          "moduleId": "delivery-operations",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "reviewed",
          "label": "Admin-reviewed reference",
          "moduleId": "cms-recovery",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "stock",
          "label": "Review return/defective stock context",
          "moduleId": "rider-stock",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        }
      ],
      "edges": [
        {
          "from": "exception",
          "to": "postpone",
          "condition": "Postponed and not yet confirmed",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "exception",
          "to": "failed",
          "condition": "Failed without decision",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "exception",
          "to": "price",
          "condition": "Pending price approval",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "exception",
          "to": "van",
          "condition": "NWD stock remains on van",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "postpone",
          "to": "validate",
          "condition": "Admin or manager accepts the pending proposal or chooses a different valid date",
          "evidenceStatus": "source-reviewed",
          "note": "A rider request takes precedence over an already-written postponed date. The action requires a postponement to exist.",
          "sourceRefs": [
            "lib/reschedule-actions.ts:360",
            "lib/reschedule-actions.ts:381",
            "lib/reschedule-actions.ts:431"
          ]
        },
        {
          "from": "postpone",
          "to": "reject",
          "condition": "Admin or manager rejects the postponement",
          "evidenceStatus": "source-reviewed",
          "note": "The action clears both proposed and active postponed dates. Existing delivery status and rider notes remain intact.",
          "sourceRefs": [
            "lib/reschedule-actions.ts:367",
            "lib/reschedule-actions.ts:384"
          ]
        },
        {
          "from": "validate",
          "to": "flow",
          "condition": "Validated day joins the flow",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "reject",
          "to": "flow",
          "condition": "Rejection restores the original delivery date",
          "evidenceStatus": "source-reviewed",
          "note": "Clearing the postponed date makes the active date fall back to the original day; this does not itself mark the delivery successful.",
          "sourceRefs": [
            "lib/reschedule-actions.ts:384",
            "lib/reschedule-actions.ts:395"
          ]
        },
        {
          "from": "failed",
          "to": "reviewed",
          "condition": "Admin or manager marks the failure reviewed",
          "evidenceStatus": "source-reviewed",
          "note": "The reviewed marker does not change the delivery status.",
          "sourceRefs": [
            "lib/cms-actions.ts:174"
          ]
        },
        {
          "from": "price",
          "to": "reviewed",
          "condition": "Admin decides the request",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "van",
          "to": "stock",
          "condition": "Stock disposition needs review",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        }
      ],
      "humanBoundary": "Validation, rejection and price/failure decisions remain human review actions.",
      "caveat": "Rider proposals are not yet live; an already-written postponed date may already steer the round. Source distinguishes both cases. Downstream database effects were not exercised."
    },
    {
      "id": "stock-reconciliation",
      "name": "Physical Stock Reconciliation",
      "purpose": "Distinguish known inventory, uncounted quantities and rider stock movement.",
      "evidenceStatus": "observed-modules-conceptual-handoffs",
      "roles": [
        "storekeeper",
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "nodes": [
        {
          "id": "catalog",
          "label": "Catalog stock and shelf context",
          "moduleId": "inventory-catalog",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "unknown",
          "label": "Quantity is uncounted",
          "moduleId": "inventory-catalog",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "physical",
          "label": "Physical count batch",
          "moduleId": "warehouse-counts",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "variance",
          "label": "Review first counts and variance",
          "moduleId": "warehouse-counts",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "approved",
          "label": "Approved batch history",
          "moduleId": "warehouse-counts",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "verified",
          "label": "Physically verified stock view",
          "moduleId": "inventory-catalog",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "rider",
          "label": "Rider opening, received and in-transit stock",
          "moduleId": "rider-stock",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "result",
          "label": "Delivered, returned or defective quantities",
          "moduleId": "rider-stock",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "unmatched",
          "label": "Undelivered product is unmatched",
          "moduleId": "inventory-catalog",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        }
      ],
      "edges": [
        {
          "from": "catalog",
          "to": "unknown",
          "condition": "To Count or uncounted state",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "unknown",
          "to": "physical",
          "condition": "A physical count is needed",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "physical",
          "to": "variance",
          "condition": "Batch contains counts and differences",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "variance",
          "to": "approved",
          "condition": "An admin explicitly approves a submitted count",
          "evidenceStatus": "source-reviewed",
          "note": "The server checks the approver; the included SQL also checks the reviewer and rejects counts outside submitted status. Applied production SQL was not verified.",
          "sourceRefs": [
            "lib/stock-count-actions.ts:51",
            "lib/stock-count-actions.ts:488",
            "scripts/create-stock-counts.sql:85",
            "scripts/create-stock-counts.sql:103"
          ]
        },
        {
          "from": "approved",
          "to": "verified",
          "condition": "Successful approval applies counted quantities in the included database function",
          "evidenceStatus": "source-reviewed",
          "note": "The source function writes product quantity and last-counted time. This describes supplied SQL, not a verified live database result.",
          "sourceRefs": [
            "scripts/create-stock-counts.sql:110",
            "lib/stock-count-actions.ts:496"
          ]
        },
        {
          "from": "catalog",
          "to": "rider",
          "condition": "Warehouse and rider stock are related",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "rider",
          "to": "result",
          "condition": "Daily movement categories are recorded",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "result",
          "to": "catalog",
          "condition": "Operational movement informs reconciliation",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "catalog",
          "to": "unmatched",
          "condition": "Undelivered rows have no product match",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "unmatched",
          "to": "variance",
          "condition": "Resolve identity before interpreting quantities",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        }
      ],
      "humanBoundary": "Uncounted is not zero. Approval, product merging and ledger corrections are separate actions.",
      "caveat": "Count approval logic was reviewed in the server action and included SQL. Production migration state, successful posting and exact Actual-stock arithmetic remain unverified."
    },
    {
      "id": "standing-plan-to-day",
      "name": "Standing Coverage to Daily Placement",
      "purpose": "Explain how permanent coverage and single-day changes relate.",
      "evidenceStatus": "ui-described-with-observed-controls",
      "roles": [
        "admin",
        "manager",
        "contractor",
        "rider"
      ],
      "nodes": [
        {
          "id": "standing",
          "label": "Permanent region and locality coverage",
          "moduleId": "territory-planning",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "resolve",
          "label": "Resolve contractor-to-rider default",
          "moduleId": "territory-planning",
          "kind": "decision",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "single",
          "label": "Explicit rider or one active contractor rider supplies the default",
          "moduleId": "territory-planning",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "choice",
          "label": "Multiple riders or gap needs a choice",
          "moduleId": "territory-planning",
          "kind": "branch",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "day",
          "label": "Review one day's orders and coverage",
          "moduleId": "territory-planning",
          "kind": "step",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "map",
          "label": "Assess map-position confidence",
          "moduleId": "territory-planning",
          "kind": "decision",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "deviation",
          "label": "Stage only changes for this day",
          "moduleId": "territory-planning",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "validate",
          "label": "Validate daily placement",
          "moduleId": "territory-planning",
          "kind": "human-action",
          "evidenceStatus": "observed-ui"
        },
        {
          "id": "operations",
          "label": "Daily coverage informs delivery work",
          "moduleId": "delivery-operations",
          "kind": "outcome",
          "evidenceStatus": "observed-ui"
        }
      ],
      "edges": [
        {
          "from": "standing",
          "to": "resolve",
          "condition": "Standing plan provides defaults",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "resolve",
          "to": "single",
          "condition": "An explicit locality rider exists, or otherwise the contractor has exactly one active rider",
          "evidenceStatus": "source-reviewed",
          "note": "The explicit locality assignment takes precedence; contractor-derived coverage remains labeled as derived.",
          "sourceRefs": [
            "lib/placement/effective.ts:143"
          ]
        },
        {
          "from": "resolve",
          "to": "choice",
          "condition": "No explicit rider exists and the contractor has several active riders or no active rider",
          "evidenceStatus": "source-reviewed",
          "note": "Several riders remain ambiguous; no available rider remains unassigned. The source does not guess a rider.",
          "sourceRefs": [
            "lib/placement/effective.ts:148"
          ]
        },
        {
          "from": "single",
          "to": "day",
          "condition": "Use the standing assignment unless a day-specific exception exists",
          "evidenceStatus": "source-reviewed",
          "note": "A daily exception takes precedence over the standing rider.",
          "sourceRefs": [
            "lib/placement/effective.ts:163",
            "lib/placement/effective.ts:190"
          ]
        },
        {
          "from": "choice",
          "to": "day",
          "condition": "Planner identifies unresolved coverage",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "day",
          "to": "map",
          "condition": "Use geographic view",
          "evidenceStatus": "observed-ui",
          "note": null
        },
        {
          "from": "map",
          "to": "deviation",
          "condition": "Review estimated versus real location before changing coverage",
          "evidenceStatus": "conceptual-handoff",
          "note": null
        },
        {
          "from": "deviation",
          "to": "validate",
          "condition": "Daily changes need validation",
          "evidenceStatus": "ui-described",
          "note": null
        },
        {
          "from": "validate",
          "to": "operations",
          "condition": "Person validates an existing draft day plan and the guarded updates succeed",
          "evidenceStatus": "source-reviewed",
          "note": "Source freezes effective coverage and changes riders only for pending or assigned orders on the selected active date whose nonempty target differs. Short writes or errors leave validation incomplete.",
          "sourceRefs": [
            "lib/placement-actions.ts:16",
            "lib/placement-actions.ts:216",
            "lib/placement-actions.ts:239",
            "lib/placement-actions.ts:255",
            "lib/placement-actions.ts:279"
          ]
        },
        {
          "from": "day",
          "to": "operations",
          "condition": "No day exception exists; the standing plan supplies coverage",
          "evidenceStatus": "source-reviewed",
          "note": "Displaying default coverage does not itself rewrite existing order assignments. Day validation applies the assignment changes.",
          "sourceRefs": [
            "lib/placement/effective.ts:190",
            "lib/placement-actions.ts:216"
          ]
        }
      ],
      "humanBoundary": "Selecting or inspecting a day is distinct from changing assignments. Daily validation and correction of estimated locations require deliberate action.",
      "caveat": "Default resolution and validation conditions were reviewed in source. Validation can reassign open orders; no assignments or map coordinates were changed or tested."
    },
    {
      "id": "storefront-to-delivery",
      "name": "Storefront to Delivery Order",
      "purpose": "Show what happens when a customer submits a public shop order.",
      "evidenceStatus": "source-reviewed",
      "roles": [],
      "actors": [
        "Customer without a staff account"
      ],
      "nodes": [
        {
          "id": "browse",
          "label": "Browse catalogue and build a basket",
          "moduleId": "public-storefront",
          "kind": "step",
          "evidenceStatus": "source-reviewed"
        },
        {
          "id": "submit",
          "label": "Submit contact, locality and quantities",
          "moduleId": "public-storefront",
          "kind": "human-action",
          "evidenceStatus": "source-reviewed"
        },
        {
          "id": "check",
          "label": "Check locality, stock and server prices",
          "moduleId": "public-storefront",
          "kind": "decision",
          "evidenceStatus": "source-reviewed"
        },
        {
          "id": "fix",
          "label": "Correct details or unavailable items",
          "moduleId": "public-storefront",
          "kind": "branch",
          "evidenceStatus": "source-reviewed"
        },
        {
          "id": "pending",
          "label": "Create pending delivery entries",
          "moduleId": "delivery-operations",
          "kind": "outcome",
          "evidenceStatus": "source-reviewed"
        },
        {
          "id": "reference",
          "label": "Show accepted order reference",
          "moduleId": "public-storefront",
          "kind": "outcome",
          "evidenceStatus": "source-reviewed"
        }
      ],
      "edges": [
        {
          "from": "browse",
          "to": "submit",
          "condition": "Customer chooses checkout and submits",
          "evidenceStatus": "source-reviewed",
          "note": "Browsing alone does not create a delivery order.",
          "sourceRefs": [
            "app/shop/checkout/page.tsx:1"
          ]
        },
        {
          "from": "submit",
          "to": "check",
          "condition": "Checkout request contains customer details and basket quantities",
          "evidenceStatus": "source-reviewed",
          "note": "Client prices are not trusted; repeated product IDs are combined before stock checks.",
          "sourceRefs": [
            "app/api/shop/order/route.ts:9",
            "app/api/shop/order/route.ts:47"
          ]
        },
        {
          "from": "check",
          "to": "fix",
          "condition": "Details are invalid, stock is insufficient, or an item needs a quote",
          "evidenceStatus": "source-reviewed",
          "note": "Validation errors return before the insert.",
          "sourceRefs": [
            "app/api/shop/order/route.ts:66",
            "app/api/shop/order/route.ts:95",
            "app/api/shop/order/route.ts:114"
          ]
        },
        {
          "from": "fix",
          "to": "submit",
          "condition": "Customer corrects the basket or details and deliberately tries again",
          "evidenceStatus": "conceptual-handoff",
          "note": "An explanatory retry path, not an automatic retry."
        },
        {
          "from": "check",
          "to": "pending",
          "condition": "All checked products are available, quantities fit stock and calculated amounts are positive",
          "evidenceStatus": "source-reviewed",
          "note": "The source inserts pending WEB delivery rows using the selected locality for routing. No stock reservation or charge is asserted.",
          "sourceRefs": [
            "app/api/shop/order/route.ts:95",
            "app/api/shop/order/route.ts:123",
            "app/api/shop/order/route.ts:152"
          ]
        },
        {
          "from": "pending",
          "to": "reference",
          "condition": "The database insert succeeds",
          "evidenceStatus": "source-reviewed",
          "note": "An insert error is returned as a failure. Payment and delivery completion are separate downstream operations.",
          "sourceRefs": [
            "app/api/shop/order/route.ts:152",
            "app/api/shop/order/route.ts:158"
          ]
        }
      ],
      "humanBoundary": "The customer chooses and submits the order. A pending order is not a completed delivery or a collected payment.",
      "caveat": "Source was reviewed; no public order was submitted. Runtime stock concurrency, database triggers and payment operations were not tested."
    }
  ],
  "roles": [
    {
      "id": "admin",
      "name": "Admin",
      "involvement": "The audited view was an administrator view spanning operational review, catalog, money, people and settings.",
      "moduleIds": [
        "business-overview",
        "customer-inbox",
        "product-master",
        "advertising",
        "client-history",
        "delivery-operations",
        "cms-recovery",
        "logistics-team",
        "customer-collections",
        "contractor-payouts",
        "payroll",
        "deductions",
        "inventory-catalog",
        "rider-stock",
        "warehouse-counts",
        "imports",
        "foreign-suppliers",
        "china-reorders",
        "local-supplier-orders",
        "local-purchases",
        "staff-schedules",
        "territory-planning",
        "administration",
        "extensions-guide"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "admin",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "manager",
      "name": "Manager",
      "involvement": "Suggested operational oversight across demand, logistics, stock, procurement, money and staffing; inferred from the role name and module responsibilities.",
      "moduleIds": [
        "business-overview",
        "customer-inbox",
        "product-master",
        "advertising",
        "client-history",
        "delivery-operations",
        "cms-recovery",
        "logistics-team",
        "customer-collections",
        "contractor-payouts",
        "payroll",
        "deductions",
        "inventory-catalog",
        "rider-stock",
        "warehouse-counts",
        "imports",
        "foreign-suppliers",
        "china-reorders",
        "local-supplier-orders",
        "local-purchases",
        "staff-schedules",
        "territory-planning",
        "extensions-guide"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "manager",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "marketing-agent",
      "name": "Marketing Agent",
      "involvement": "Suggested lead handling, order entry and product/campaign context; involvement is inferred rather than permission-tested.",
      "moduleIds": [
        "business-overview",
        "customer-inbox",
        "product-master",
        "advertising",
        "client-history",
        "delivery-operations",
        "inventory-catalog",
        "staff-schedules",
        "extensions-guide"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "marketing_agent",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "marketing-back-office",
      "name": "Marketing Back Office",
      "involvement": "Suggested entry review, inbox follow-up and customer/order context; no distinct back-office access rules were audited.",
      "moduleIds": [
        "business-overview",
        "customer-inbox",
        "product-master",
        "client-history",
        "delivery-operations",
        "staff-schedules",
        "extensions-guide"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "marketing_back_office",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "marketing-front-office",
      "name": "Marketing Front Office",
      "involvement": "Suggested customer conversation and order-capture involvement; no distinct front-office access rules were audited.",
      "moduleIds": [
        "business-overview",
        "customer-inbox",
        "product-master",
        "client-history",
        "delivery-operations",
        "staff-schedules",
        "extensions-guide"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "marketing_front_office",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "contractor",
      "name": "Contractor",
      "involvement": "A participant in rider teams, delivery outcomes, earnings, stock and territorial coverage. Participant status does not imply access to all admin screens.",
      "moduleIds": [
        "delivery-operations",
        "cms-recovery",
        "logistics-team",
        "customer-collections",
        "contractor-payouts",
        "deductions",
        "rider-stock",
        "staff-schedules",
        "territory-planning"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "contractor",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "rider",
      "name": "Rider",
      "involvement": "A participant in assignments, delivery outcomes, customer collection, van stock and daily coverage. Role-specific screens were not inspected by impersonation.",
      "moduleIds": [
        "delivery-operations",
        "cms-recovery",
        "logistics-team",
        "customer-collections",
        "deductions",
        "rider-stock",
        "staff-schedules",
        "territory-planning"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "rider",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    },
    {
      "id": "storekeeper",
      "name": "Storekeeper",
      "involvement": "Suggested catalog, physical-count, stock-movement and receiving involvement; inferred rather than permission-tested.",
      "moduleIds": [
        "product-master",
        "inventory-catalog",
        "rider-stock",
        "warehouse-counts",
        "imports",
        "local-purchases",
        "staff-schedules"
      ],
      "labelEvidence": "Observed in User Management and matched to the UserRole values and ROLE_LABELS in current source.",
      "involvementEvidence": "inferred-not-permissions",
      "permissionsVerified": false,
      "sourceRole": "storekeeper",
      "sourceRefs": [
        "lib/types.ts:1",
        "lib/types.ts:388"
      ]
    }
  ],
  "relatedObservations": [
    {
      "id": "scope-sensitive-metrics",
      "kind": "interpretation",
      "summary": "Counts differ between overview, team and staff views. Keep scope and freshness visible before comparing metrics."
    },
    {
      "id": "deductions-placeholder",
      "kind": "availability",
      "summary": "Deductions is explicitly Coming Soon."
    },
    {
      "id": "stock-confidence",
      "kind": "data-quality",
      "summary": "Uncounted stock and unmatched undelivered products require distinct labels rather than zero-value assumptions."
    },
    {
      "id": "map-confidence",
      "kind": "data-quality",
      "summary": "Real locations, geocoded estimates and district-only estimates are different confidence levels."
    },
    {
      "id": "extension-doc-drift",
      "kind": "documentation",
      "summary": "Tools-page preview and later release notes differ on PIN-based clocking. Do not adopt the old preview as a verified rule."
    },
    {
      "id": "source-needed",
      "kind": "verification",
      "summary": "Verify current source before publishing schema/API totals or declaring documented automation operational."
    }
  ],
  "sourceVerification": {
    "scope": "Existing catalog routes, exact role identifiers and selected workflow conditions, plus the current-source public storefront authorized during reconciliation.",
    "primaryRoutesVerified": 35,
    "relatedRoutesVerified": 5,
    "staleRoutesFound": 0,
    "rolesMatched": 8,
    "permissionsTested": false,
    "businessActionsExecuted": false,
    "note": "Catalog role IDs remain stable editorial identifiers; sourceRole contains the exact stored role value. Route templates containing [id] are not concrete navigable records."
  }
}

const improvements = [
  {
    "id": "recover-checkout-retries",
    "title": "Recover an order after a connection drop",
    "problem": "Checkout disables its button while sending, but the reviewed order handler has no saved request key. A lost success response leaves the customer unsure whether the order exists.",
    "proposal": "Give each checkout attempt a stable request reference. Repeating the same submission should recover the original order and confirmation.",
    "benefit": "Fewer duplicate deliveries and fewer customers resubmitting an order that already succeeded.",
    "priority": "High",
    "scope": [
      "public-storefront",
      "delivery-operations"
    ],
    "humanBoundary": "The customer still submits deliberately. A changed basket requires a new attempt; this proposal does not place orders or take payment."
  },
  {
    "id": "commit-stock-with-checkout",
    "title": "Protect the last available units",
    "problem": "The shop checks available quantities before inserting delivery rows. The reviewed handler does not reserve those units as part of the same operation.",
    "proposal": "Agree when an accepted order reserves stock, then combine availability checks and reservation in one protected save. Show any shortage before confirming acceptance.",
    "benefit": "Two customers ordering together are less likely to receive promises against the same remaining stock.",
    "priority": "High",
    "scope": [
      "public-storefront",
      "inventory-catalog",
      "delivery-operations"
    ],
    "humanBoundary": "Owners must choose reservation, expiry and cancellation rules first. Verify current database behavior before changing stock or order acceptance."
  },
  {
    "id": "keep-drafts-with-their-lead",
    "title": "Keep every AI draft with its customer",
    "problem": "Opening a lead can start AI assistance. Its response updates the shared draft and order fields, without checking again that the same lead is still open.",
    "proposal": "Attach each request to its lead and conversation version. Ignore an outdated response after the agent switches leads, while preserving their typed corrections.",
    "benefit": "Fast navigation cannot place a previous conversation's suggestions into the current customer's form.",
    "priority": "High",
    "scope": [
      "customer-inbox",
      "delivery-operations"
    ],
    "humanBoundary": "AI only suggests text and fields. Sending and creating an order still require the agent's separate actions."
  },
  {
    "id": "recover-placement-validation",
    "title": "Make daily assignment changes recoverable",
    "problem": "Placement updates groups of orders before marking the day validated. If a later write fails, earlier groups may already have moved while validation remains incomplete.",
    "proposal": "Apply the reviewed assignment set as one protected operation, or save an exact progress record that makes a retry safe. Show what changed when an attempt fails.",
    "benefit": "Dispatchers can recover confidently without guessing which riders received the new assignments.",
    "priority": "High",
    "scope": [
      "territory-planning",
      "delivery-operations",
      "logistics-team"
    ],
    "humanBoundary": "A dispatcher confirms the affected orders. Reopening a day must not silently undo completed assignment changes."
  },
  {
    "id": "review-stock-moved-since-count",
    "title": "Check movement before approving an old count",
    "problem": "The supplied approval function writes counted quantities into inventory. It does not compare stock movement since the physical count before applying those figures.",
    "proposal": "Record the count's stock baseline and flag later receipts, dispatches or corrections. Let the reviewer reconcile those movements before approval.",
    "benefit": "An accurate morning count is less likely to overwrite valid movements recorded later in the day.",
    "priority": "High",
    "scope": [
      "warehouse-counts",
      "inventory-catalog",
      "rider-stock"
    ],
    "humanBoundary": "First verify the deployed approval function. The admin decides how to resolve later movement; an uncounted quantity remains unknown."
  },
  {
    "id": "record-cms-review-as-a-decision",
    "title": "Give delivery reviews a clear history",
    "problem": "The reviewed CMS action marks a case reviewed by adding text to delivery notes. That marker alone does not identify the reviewer, decision time or reason.",
    "proposal": "Store review state, reviewer, timestamp and reason as structured information, with a visible history. Preserve rider notes as the account of the delivery attempt.",
    "benefit": "Managers can trace why a case was closed or reopened without interpreting a note prefix.",
    "priority": "Medium",
    "scope": [
      "cms-recovery",
      "delivery-operations"
    ],
    "humanBoundary": "Reviewing a case must not change its delivery status or stock disposition unless a separate action explicitly does so."
  },
  {
    "id": "show-ai-cost-by-feature",
    "title": "See what each AI feature costs",
    "problem": "Inbox assistance uses a direct model provider, while 1688 research tracks its own paid attempts and reservations. Those measures do not by themselves form one comparable cost history.",
    "proposal": "Add a feature-level usage view that separates requested, reserved and completed work from actual provider charges. Reconcile interrupted research without treating every reservation as a charge.",
    "benefit": "Owners can identify expensive repeated work and set informed budgets without weakening useful assistance blindly.",
    "priority": "Medium",
    "scope": [
      "customer-inbox",
      "china-reorders",
      "administration"
    ],
    "humanBoundary": "Use provider-confirmed costs or label estimates clearly. Budget changes and paid retries remain explicit decisions; viewing the report starts no AI work."
  },
  {
    "id": "verify-critical-actions-by-role",
    "title": "Verify access where important decisions happen",
    "problem": "Navigation, page access and action checks differ. For example, stock-count approval has an admin check even though several roles are involved in stock work.",
    "proposal": "Verify allowed and denied actions for each staff role using controlled test records. Prioritize counts, purchases, assignments, user changes and money recording, and keep the results with their check dates.",
    "benefit": "Staff receive a reliable access guide and important actions have evidence beyond a visible menu item.",
    "priority": "Medium",
    "scope": [
      "administration",
      "warehouse-counts",
      "local-purchases",
      "territory-planning",
      "customer-collections",
      "contractor-payouts"
    ],
    "humanBoundary": "Use a safe test environment and defined expected permissions. A review must not grant roles or exercise real business transactions."
  }
]

const source = {
  "version": "v949",
  "checkedOn": "2026-09-11",
  "pageCount": 103,
  "apiRouteCount": 127,
  "tableRefs": [
    {
      "name": "ad_edit_baselines",
      "source": "app/api/facebook-ads/edit-baselines/route.ts:35"
    },
    {
      "name": "ad_kill_state",
      "source": "app/api/ads/ad-attribution/route.ts:79"
    },
    {
      "name": "address_region_mappings",
      "source": "lib/partner-actions.ts:37"
    },
    {
      "name": "ads_cache",
      "source": "app/api/extension/list-ads/route.ts:86"
    },
    {
      "name": "bank_deposits",
      "source": "app/dashboard/storekeeper/balance/page.tsx:25"
    },
    {
      "name": "bank_transactions",
      "source": "lib/payment-confirmation-actions.ts:59"
    },
    {
      "name": "building_facades",
      "source": "scripts/create-building-facades.sql:2"
    },
    {
      "name": "campaign_product_links",
      "source": "app/api/campaign-links/route.ts:9"
    },
    {
      "name": "cash_collection_sessions",
      "source": "app/dashboard/storekeeper/daily-summary/page.tsx:15"
    },
    {
      "name": "cash_collection_summary",
      "source": "app/dashboard/storekeeper/cash-collection/page.tsx:29"
    },
    {
      "name": "cash_collections",
      "source": "scripts/create-accounting-tables.sql:108"
    },
    {
      "name": "clients",
      "source": "app/api/clients/find-by-name/route.ts:60"
    },
    {
      "name": "clients_import_log",
      "source": "lib/client-actions.ts:163"
    },
    {
      "name": "clip_jobs",
      "source": "app/api/product-master/clip-jobs/route.ts:185"
    },
    {
      "name": "cms_log",
      "source": "lib/cms-log.ts:30"
    },
    {
      "name": "company_settings",
      "source": "app/api/company-settings/route.ts:9"
    },
    {
      "name": "contractor_daily_stock",
      "source": "app/dashboard/contractors/stock/page.tsx:76"
    },
    {
      "name": "contractor_payroll_profiles",
      "source": "app/dashboard/contractors/accounting/page.tsx:31"
    },
    {
      "name": "contractor_payslips",
      "source": "app/dashboard/contractors/accounting/page.tsx:37"
    },
    {
      "name": "contractor_stock_validation",
      "source": "app/dashboard/contractors/deliveries/page.tsx:77"
    },
    {
      "name": "contractors",
      "source": "app/api/contractor-stats/route.ts:26"
    },
    {
      "name": "day_placement_entries",
      "source": "app/api/extension/route.ts:359"
    },
    {
      "name": "day_placements",
      "source": "app/api/extension/route.ts:352"
    },
    {
      "name": "deductions",
      "source": "app/api/deductions/route.ts:22"
    },
    {
      "name": "deliveries",
      "source": "app/api/ads/ad-attribution/route.ts:41"
    },
    {
      "name": "delivery_archive",
      "source": "app/api/deliveries/reconcile/revert/route.ts:63"
    },
    {
      "name": "delivery_attempts",
      "source": "lib/reschedule-actions.ts:170"
    },
    {
      "name": "delivery_change_log",
      "source": "lib/agent-actions.ts:141"
    },
    {
      "name": "delivery_imports",
      "source": "app/api/deliveries/reconcile/revert/route.ts:41"
    },
    {
      "name": "employee_payroll_profiles",
      "source": "app/dashboard/deliveries/payroll/page.tsx:30"
    },
    {
      "name": "executives",
      "source": "app/dashboard/admin/executives/page.tsx:24"
    },
    {
      "name": "expenses",
      "source": "app/api/expenses/route.ts:22"
    },
    {
      "name": "extension_settings",
      "source": "app/api/extension/ai-reply/route.ts:71"
    },
    {
      "name": "foreign_supplier_aliases",
      "source": "lib/purchase-orders/supplier-quality.ts:23"
    },
    {
      "name": "foreign_supplier_profiles",
      "source": "lib/purchase-orders/supplier-quality.ts:22"
    },
    {
      "name": "foreign_supplier_quality_notes",
      "source": "lib/purchase-orders/supplier-quality.ts:41"
    },
    {
      "name": "import_mappings",
      "source": "app/api/deliveries/reconcile/mappings/route.ts:59"
    },
    {
      "name": "import_purchase_events",
      "source": "lib/purchase-orders/1688-sourcing-service.ts:25"
    },
    {
      "name": "import_reorder_1688_checks",
      "source": "lib/purchase-orders/1688-check-service.ts:57"
    },
    {
      "name": "import_reorder_1688_jobs",
      "source": "lib/purchase-orders/1688-queue.ts:86"
    },
    {
      "name": "import_reorder_1688_runs",
      "source": "app/.well-known/workflow/v1/step/route.js:39"
    },
    {
      "name": "import_reorder_1688_selections",
      "source": "lib/purchase-orders/1688-sourcing-service.ts:42"
    },
    {
      "name": "import_reorder_items",
      "source": "lib/purchase-orders/1688-check-service.ts:67"
    },
    {
      "name": "import_reorder_lines",
      "source": "lib/purchase-orders/reorder-service.ts:211"
    },
    {
      "name": "import_reorder_settings",
      "source": "lib/purchase-orders/reorder-service.ts:301"
    },
    {
      "name": "import_reorders",
      "source": "lib/purchase-orders/reorder-service.ts:208"
    },
    {
      "name": "imported_order_keys",
      "source": "app/api/clients/import-history/route.ts:144"
    },
    {
      "name": "inbox_sync_state",
      "source": "lib/facebook/comment-cache.ts:174"
    },
    {
      "name": "letter_requests",
      "source": "app/dashboard/contractors/accounting/page.tsx:44"
    },
    {
      "name": "local_purchase_documents",
      "source": "lib/local-purchasing/documents.ts:82"
    },
    {
      "name": "local_purchase_lines",
      "source": "lib/local-purchasing/existing.ts:51"
    },
    {
      "name": "local_purchase_order_lines",
      "source": "lib/local-purchasing/order-service.ts:70"
    },
    {
      "name": "local_purchase_orders",
      "source": "lib/local-purchasing/documents.ts:20"
    },
    {
      "name": "local_purchases",
      "source": "lib/local-purchasing/existing.ts:40"
    },
    {
      "name": "local_supplier_products",
      "source": "lib/local-purchasing/supplier-catalogue.ts:18"
    },
    {
      "name": "local_suppliers",
      "source": "app/dashboard/purchasing/local/actions.ts:212"
    },
    {
      "name": "localities",
      "source": "app/api/admin/localities/route.ts:48"
    },
    {
      "name": "locality_coordinates",
      "source": "lib/placement-actions.ts:71"
    },
    {
      "name": "messenger_ad_refs",
      "source": "lib/messenger/ad-refs.ts:85"
    },
    {
      "name": "messenger_conversations",
      "source": "lib/messenger/ad-refs.ts:106"
    },
    {
      "name": "messenger_messages",
      "source": "lib/messenger/cache.ts:136"
    },
    {
      "name": "notifications",
      "source": "app/api/notifications/route.ts:14"
    },
    {
      "name": "order_modifications",
      "source": "lib/admin-actions.ts:1044"
    },
    {
      "name": "page_comments",
      "source": "app/api/inbox/comments/route.ts:163"
    },
    {
      "name": "page_logos",
      "source": "app/api/page-logos/route.ts:24"
    },
    {
      "name": "page_post_ads",
      "source": "lib/facebook/page-usage.ts:44"
    },
    {
      "name": "partner_deliveries",
      "source": "app/dashboard/contractors/my-deliveries/page.tsx:182"
    },
    {
      "name": "partner_rider_region_defaults",
      "source": "app/dashboard/contractors/my-deliveries/page.tsx:193"
    },
    {
      "name": "partner_sheets",
      "source": "app/dashboard/contractors/my-deliveries/page.tsx:173"
    },
    {
      "name": "payment_transactions",
      "source": "app/api/contractor-stats/route.ts:75"
    },
    {
      "name": "payout_requests",
      "source": "app/dashboard/admin/team/page.tsx:181"
    },
    {
      "name": "payslips",
      "source": "app/dashboard/deliveries/payroll/page.tsx:35"
    },
    {
      "name": "po_status_backup_2026_08_22",
      "source": "scripts/mark-transit-pos-received.sql:34"
    },
    {
      "name": "post_ad_sync",
      "source": "app/api/ads/post-ad-sync/route.ts:76"
    },
    {
      "name": "product_1688_preferences",
      "source": "lib/purchase-orders/1688-check-service.ts:75"
    },
    {
      "name": "product_1688_sku_links",
      "source": "components/deliveries/inventory-content.tsx:1485"
    },
    {
      "name": "product_aliases",
      "source": "app/api/product-master/merge/route.ts:35"
    },
    {
      "name": "product_clips",
      "source": "app/api/product-master/clip-jobs/route.ts:89"
    },
    {
      "name": "product_image_scores",
      "source": "app/api/product-master/rank-images/route.ts:44"
    },
    {
      "name": "product_images",
      "source": "app/api/product-master/images/route.ts:27"
    },
    {
      "name": "product_links",
      "source": "app/api/product-master/links/route.ts:38"
    },
    {
      "name": "product_posts",
      "source": "app/api/product-master/ai-post/route.ts:80"
    },
    {
      "name": "product_price_history",
      "source": "components/deliveries/price-history.tsx:114"
    },
    {
      "name": "product_review",
      "source": "scripts/create-product-review-table.sql:6"
    },
    {
      "name": "product_variants",
      "source": "app/api/extension/route.ts:97"
    },
    {
      "name": "products",
      "source": "app/api/cms-data/route.ts:10"
    },
    {
      "name": "profiles",
      "source": "app/api/admin/localities/route.ts:16"
    },
    {
      "name": "purchase_orders",
      "source": "app/api/extension/supplier-brief/route.ts:87"
    },
    {
      "name": "receipts",
      "source": "lib/receipt-utils.ts:15"
    },
    {
      "name": "region_coordinate_overrides",
      "source": "app/api/region-overrides/route.ts:16"
    },
    {
      "name": "return_collections",
      "source": "app/dashboard/contractors/returns/page.tsx:64"
    },
    {
      "name": "return_expectation_log",
      "source": "lib/return-expectation-log.ts:84"
    },
    {
      "name": "rider_payment_settings",
      "source": "app/api/rider-stats/route.ts:45"
    },
    {
      "name": "rider_placement_plans",
      "source": "app/api/admin/placement-plans/route.ts:27"
    },
    {
      "name": "rider_pois",
      "source": "app/api/rider-pois/route.ts:10"
    },
    {
      "name": "rider_region_defaults",
      "source": "app/dashboard/contractors/my-deliveries/page.tsx:143"
    },
    {
      "name": "rider_stock",
      "source": "app/dashboard/deliveries/stock/page.tsx:37"
    },
    {
      "name": "rider_work_days",
      "source": "app/api/work-days/route.ts:22"
    },
    {
      "name": "riders",
      "source": "app/api/admin/localities/route.ts:32"
    },
    {
      "name": "shift_templates",
      "source": "app/dashboard/admin/timetable/page.tsx:45"
    },
    {
      "name": "staff_leave_requests",
      "source": "app/dashboard/admin/timetable/page.tsx:70"
    },
    {
      "name": "staff_schedules",
      "source": "app/dashboard/admin/timetable/page.tsx:65"
    },
    {
      "name": "staff_shifts",
      "source": "app/api/extension/route.ts:138"
    },
    {
      "name": "stock_categories",
      "source": "app/dashboard/marketing-back-office/stock/page.tsx:29"
    },
    {
      "name": "stock_count_captures",
      "source": "app/api/stock-count/identify/route.ts:64"
    },
    {
      "name": "stock_count_items",
      "source": "app/dashboard/deliveries/stock-counts/page.tsx:47"
    },
    {
      "name": "stock_counts",
      "source": "app/dashboard/storekeeper/stock-count/page.tsx:28"
    },
    {
      "name": "stock_dispatch_sessions",
      "source": "app/dashboard/storekeeper/stock-out/page.tsx:95"
    },
    {
      "name": "stock_items",
      "source": "app/dashboard/marketing-back-office/page.tsx:49"
    },
    {
      "name": "stock_movements",
      "source": "app/dashboard/deliveries/stock/page.tsx:43"
    },
    {
      "name": "stock_transaction_items",
      "source": "components/storekeeper/stock-in-content.tsx:139"
    },
    {
      "name": "stock_transactions",
      "source": "components/deliveries/inventory-content.tsx:281"
    },
    {
      "name": "supplier_messages",
      "source": "app/api/extension/supplier-thread/route.ts:137"
    },
    {
      "name": "supplier_products",
      "source": "app/api/suppliers/products/route.ts:35"
    },
    {
      "name": "supplier_threads",
      "source": "app/api/extension/supplier-thread/route.ts:97"
    },
    {
      "name": "transfer_confirmations",
      "source": "lib/payment-confirmation-actions.ts:215"
    },
    {
      "name": "wallets",
      "source": "app/api/contractor-stats/route.ts:94"
    },
    {
      "name": "whatsapp_ad_names",
      "source": "lib/messenger/ad-refs.ts:28"
    },
    {
      "name": "whatsapp_contacts",
      "source": "lib/whatsapp/import.ts:325"
    },
    {
      "name": "whatsapp_messages",
      "source": "lib/whatsapp/import.ts:291"
    }
  ],
  "apiRoutes": [
    {
      "path": "/api/admin/localities",
      "methods": [
        "PATCH"
      ],
      "source": "app/api/admin/localities/route.ts:6"
    },
    {
      "path": "/api/admin/placement-plans",
      "methods": [
        "GET",
        "POST",
        "PUT",
        "DELETE"
      ],
      "source": "app/api/admin/placement-plans/route.ts:21"
    },
    {
      "path": "/api/ads/ad-attribution",
      "methods": [
        "GET"
      ],
      "source": "app/api/ads/ad-attribution/route.ts:21"
    },
    {
      "path": "/api/ads/ad-revenue",
      "methods": [
        "GET"
      ],
      "source": "app/api/ads/ad-revenue/route.ts:31"
    },
    {
      "path": "/api/ads/agent-activity",
      "methods": [
        "GET"
      ],
      "source": "app/api/ads/agent-activity/route.ts:7"
    },
    {
      "path": "/api/ads/ai-briefing",
      "methods": [
        "POST"
      ],
      "source": "app/api/ads/ai-briefing/route.ts:9"
    },
    {
      "path": "/api/ads/attribution-gaps",
      "methods": [
        "GET"
      ],
      "source": "app/api/ads/attribution-gaps/route.ts:32"
    },
    {
      "path": "/api/ads/kill-candidates",
      "methods": [
        "POST",
        "GET"
      ],
      "source": "app/api/ads/kill-candidates/route.ts:17"
    },
    {
      "path": "/api/ads/post-ad-sync",
      "methods": [
        "POST",
        "GET",
        "PATCH"
      ],
      "source": "app/api/ads/post-ad-sync/route.ts:41"
    },
    {
      "path": "/api/ads/rider-targets",
      "methods": [
        "PATCH"
      ],
      "source": "app/api/ads/rider-targets/route.ts:8"
    },
    {
      "path": "/api/ads/riders-regions",
      "methods": [
        "GET"
      ],
      "source": "app/api/ads/riders-regions/route.ts:12"
    },
    {
      "path": "/api/campaign-links",
      "methods": [
        "GET",
        "POST",
        "DELETE"
      ],
      "source": "app/api/campaign-links/route.ts:3"
    },
    {
      "path": "/api/cash-collections",
      "methods": [
        "GET"
      ],
      "source": "app/api/cash-collections/route.ts:5"
    },
    {
      "path": "/api/clients/find-by-name",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/clients/find-by-name/route.ts:10"
    },
    {
      "path": "/api/clients/import-history",
      "methods": [
        "POST"
      ],
      "source": "app/api/clients/import-history/route.ts:61"
    },
    {
      "path": "/api/clients/last-delivered",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/clients/last-delivered/route.ts:10"
    },
    {
      "path": "/api/clients/rating",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/clients/rating/route.ts:11"
    },
    {
      "path": "/api/cms-data",
      "methods": [
        "GET"
      ],
      "source": "app/api/cms-data/route.ts:3"
    },
    {
      "path": "/api/company-settings",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/company-settings/route.ts:4"
    },
    {
      "path": "/api/contractor-stats",
      "methods": [
        "GET"
      ],
      "source": "app/api/contractor-stats/route.ts:6"
    },
    {
      "path": "/api/deductions",
      "methods": [
        "GET",
        "POST",
        "PATCH"
      ],
      "source": "app/api/deductions/route.ts:5"
    },
    {
      "path": "/api/deliveries/duplicates",
      "methods": [
        "GET"
      ],
      "source": "app/api/deliveries/duplicates/route.ts:23"
    },
    {
      "path": "/api/deliveries/reconcile/mappings",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/deliveries/reconcile/mappings/route.ts:49"
    },
    {
      "path": "/api/deliveries/reconcile/revert",
      "methods": [
        "POST"
      ],
      "source": "app/api/deliveries/reconcile/revert/route.ts:17"
    },
    {
      "path": "/api/deliveries/reconcile",
      "methods": [
        "POST"
      ],
      "source": "app/api/deliveries/reconcile/route.ts:285"
    },
    {
      "path": "/api/download-extension",
      "methods": [
        "GET"
      ],
      "source": "app/api/download-extension/route.ts:25"
    },
    {
      "path": "/api/download-extension-1688",
      "methods": [
        "GET"
      ],
      "source": "app/api/download-extension-1688/route.ts:25"
    },
    {
      "path": "/api/expenses",
      "methods": [
        "GET",
        "POST",
        "DELETE"
      ],
      "source": "app/api/expenses/route.ts:5"
    },
    {
      "path": "/api/export-deliveries",
      "methods": [
        "GET"
      ],
      "source": "app/api/export-deliveries/route.ts:3"
    },
    {
      "path": "/api/extension/ai-reply",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/ai-reply/route.ts:21"
    },
    {
      "path": "/api/extension/guide-ai",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/guide-ai/route.ts:25"
    },
    {
      "path": "/api/extension/learn-ad-product",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/learn-ad-product/route.ts:14"
    },
    {
      "path": "/api/extension/list-ads",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/extension/list-ads/route.ts:11"
    },
    {
      "path": "/api/extension/login",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/login/route.ts:12"
    },
    {
      "path": "/api/extension/purchaser-prompt",
      "methods": [
        "GET",
        "PUT"
      ],
      "source": "app/api/extension/purchaser-prompt/route.ts:26"
    },
    {
      "path": "/api/extension/refresh",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/refresh/route.ts:10"
    },
    {
      "path": "/api/extension/resolve-ad",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/extension/resolve-ad/route.ts:14"
    },
    {
      "path": "/api/extension",
      "methods": [
        "OPTIONS",
        "GET",
        "POST",
        "PATCH",
        "PUT"
      ],
      "source": "app/api/extension/route.ts:14"
    },
    {
      "path": "/api/extension/stats",
      "methods": [
        "OPTIONS",
        "GET"
      ],
      "source": "app/api/extension/stats/route.ts:10"
    },
    {
      "path": "/api/extension/supplier-brief",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/supplier-brief/route.ts:22"
    },
    {
      "path": "/api/extension/supplier-thread",
      "methods": [
        "OPTIONS",
        "POST"
      ],
      "source": "app/api/extension/supplier-thread/route.ts:13"
    },
    {
      "path": "/api/extension/worktime",
      "methods": [
        "OPTIONS",
        "GET",
        "POST"
      ],
      "source": "app/api/extension/worktime/route.ts:12"
    },
    {
      "path": "/api/extract-juice-transfer",
      "methods": [
        "POST"
      ],
      "source": "app/api/extract-juice-transfer/route.ts:13"
    },
    {
      "path": "/api/facebook-ads/activities",
      "methods": [
        "GET"
      ],
      "source": "app/api/facebook-ads/activities/route.ts:157"
    },
    {
      "path": "/api/facebook-ads/budget",
      "methods": [
        "POST"
      ],
      "source": "app/api/facebook-ads/budget/route.ts:32"
    },
    {
      "path": "/api/facebook-ads/cached",
      "methods": [
        "GET"
      ],
      "source": "app/api/facebook-ads/cached/route.ts:68"
    },
    {
      "path": "/api/facebook-ads/create-ad",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/facebook-ads/create-ad/route.ts:27"
    },
    {
      "path": "/api/facebook-ads/duplicate",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/facebook-ads/duplicate/route.ts:108"
    },
    {
      "path": "/api/facebook-ads/edit-baselines",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/facebook-ads/edit-baselines/route.ts:26"
    },
    {
      "path": "/api/facebook-ads",
      "methods": [
        "GET"
      ],
      "source": "app/api/facebook-ads/route.ts:7"
    },
    {
      "path": "/api/facebook-ads/toggle",
      "methods": [
        "POST"
      ],
      "source": "app/api/facebook-ads/toggle/route.ts:9"
    },
    {
      "path": "/api/generate-avatar",
      "methods": [
        "POST"
      ],
      "source": "app/api/generate-avatar/route.ts:10"
    },
    {
      "path": "/api/inbox/ai-assist",
      "methods": [
        "POST"
      ],
      "source": "app/api/inbox/ai-assist/route.ts:81"
    },
    {
      "path": "/api/inbox/capabilities",
      "methods": [
        "GET"
      ],
      "source": "app/api/inbox/capabilities/route.ts:12"
    },
    {
      "path": "/api/inbox/comments",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/inbox/comments/route.ts:32"
    },
    {
      "path": "/api/inbox/messages",
      "methods": [
        "GET"
      ],
      "source": "app/api/inbox/messages/route.ts:17"
    },
    {
      "path": "/api/inbox",
      "methods": [
        "GET"
      ],
      "source": "app/api/inbox/route.ts:24"
    },
    {
      "path": "/api/inbox/send",
      "methods": [
        "POST"
      ],
      "source": "app/api/inbox/send/route.ts:7"
    },
    {
      "path": "/api/inbox/whatsapp/import",
      "methods": [
        "POST"
      ],
      "source": "app/api/inbox/whatsapp/import/route.ts:15"
    },
    {
      "path": "/api/inbox/whatsapp/media/[id]",
      "methods": [
        "GET"
      ],
      "source": "app/api/inbox/whatsapp/media/[id]/route.ts:23"
    },
    {
      "path": "/api/inbox/whatsapp",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/inbox/whatsapp/route.ts:23"
    },
    {
      "path": "/api/inbox/whatsapp/sync",
      "methods": [
        "POST"
      ],
      "source": "app/api/inbox/whatsapp/sync/route.ts:31"
    },
    {
      "path": "/api/inventory/costs",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/inventory/costs/route.ts:13"
    },
    {
      "path": "/api/inventory/find-similar",
      "methods": [
        "POST"
      ],
      "source": "app/api/inventory/find-similar/route.ts:106"
    },
    {
      "path": "/api/notifications",
      "methods": [
        "GET",
        "PATCH"
      ],
      "source": "app/api/notifications/route.ts:3"
    },
    {
      "path": "/api/notifications/send",
      "methods": [
        "POST"
      ],
      "source": "app/api/notifications/send/route.ts:3"
    },
    {
      "path": "/api/optimize-route",
      "methods": [
        "POST"
      ],
      "source": "app/api/optimize-route/route.ts:47"
    },
    {
      "path": "/api/page-logos",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/page-logos/route.ts:20"
    },
    {
      "path": "/api/product-client-stats",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-client-stats/route.ts:14"
    },
    {
      "path": "/api/product-master/ai-post",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/ai-post/route.ts:42"
    },
    {
      "path": "/api/product-master/clip-jobs",
      "methods": [
        "POST",
        "GET",
        "DELETE"
      ],
      "source": "app/api/product-master/clip-jobs/route.ts:222"
    },
    {
      "path": "/api/product-master/clips/check",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/clips/check/route.ts:10"
    },
    {
      "path": "/api/product-master/clips/known-sources",
      "methods": [
        "GET"
      ],
      "source": "app/api/product-master/clips/known-sources/route.ts:7"
    },
    {
      "path": "/api/product-master/clips",
      "methods": [
        "GET",
        "POST",
        "DELETE"
      ],
      "source": "app/api/product-master/clips/route.ts:7"
    },
    {
      "path": "/api/product-master/generate-music",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/generate-music/route.ts:22"
    },
    {
      "path": "/api/product-master/generate-post",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/generate-post/route.ts:109"
    },
    {
      "path": "/api/product-master/image-lookup",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/image-lookup/route.ts:112"
    },
    {
      "path": "/api/product-master/image-search",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/image-search/route.ts:193"
    },
    {
      "path": "/api/product-master/images",
      "methods": [
        "GET",
        "POST",
        "DELETE"
      ],
      "source": "app/api/product-master/images/route.ts:12"
    },
    {
      "path": "/api/product-master/links",
      "methods": [
        "GET",
        "POST",
        "PATCH",
        "DELETE"
      ],
      "source": "app/api/product-master/links/route.ts:23"
    },
    {
      "path": "/api/product-master/marketplace-search/diagnose",
      "methods": [
        "GET"
      ],
      "source": "app/api/product-master/marketplace-search/diagnose/route.ts:20"
    },
    {
      "path": "/api/product-master/marketplace-search",
      "methods": [
        "POST",
        "GET"
      ],
      "source": "app/api/product-master/marketplace-search/route.ts:101"
    },
    {
      "path": "/api/product-master/merge",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/product-master/merge/route.ts:25"
    },
    {
      "path": "/api/product-master/overview",
      "methods": [
        "GET",
        "PATCH"
      ],
      "source": "app/api/product-master/overview/route.ts:10"
    },
    {
      "path": "/api/product-master/photo-terms",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/photo-terms/route.ts:20"
    },
    {
      "path": "/api/product-master/poster-generate",
      "methods": [
        "POST",
        "GET"
      ],
      "source": "app/api/product-master/poster-generate/route.ts:29"
    },
    {
      "path": "/api/product-master/posts/cta-status",
      "methods": [
        "GET"
      ],
      "source": "app/api/product-master/posts/cta-status/route.ts:19"
    },
    {
      "path": "/api/product-master/posts/facebook",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/product-master/posts/facebook/route.ts:21"
    },
    {
      "path": "/api/product-master/posts/publish",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/product-master/posts/publish/route.ts:15"
    },
    {
      "path": "/api/product-master/posts",
      "methods": [
        "GET",
        "POST",
        "PUT",
        "DELETE"
      ],
      "source": "app/api/product-master/posts/route.ts:7"
    },
    {
      "path": "/api/product-master/rank-images",
      "methods": [
        "POST",
        "GET"
      ],
      "source": "app/api/product-master/rank-images/route.ts:19"
    },
    {
      "path": "/api/product-master/reels-search",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/reels-search/route.ts:19"
    },
    {
      "path": "/api/product-master/remove-bg",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/remove-bg/route.ts:12"
    },
    {
      "path": "/api/product-master/video-fetch",
      "methods": [
        "POST",
        "GET"
      ],
      "source": "app/api/product-master/video-fetch/route.ts:21"
    },
    {
      "path": "/api/product-master/video-search",
      "methods": [
        "POST"
      ],
      "source": "app/api/product-master/video-search/route.ts:100"
    },
    {
      "path": "/api/products/delete",
      "methods": [
        "POST"
      ],
      "source": "app/api/products/delete/route.ts:19"
    },
    {
      "path": "/api/products/duplicates",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/products/duplicates/route.ts:69"
    },
    {
      "path": "/api/products/link",
      "methods": [
        "POST"
      ],
      "source": "app/api/products/link/route.ts:14"
    },
    {
      "path": "/api/products/merge",
      "methods": [
        "POST"
      ],
      "source": "app/api/products/merge/route.ts:43"
    },
    {
      "path": "/api/products/pair",
      "methods": [
        "GET"
      ],
      "source": "app/api/products/pair/route.ts:18"
    },
    {
      "path": "/api/products/review/[id]",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/products/review/[id]/route.ts:10"
    },
    {
      "path": "/api/products/review/prepare",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/products/review/prepare/route.ts:62"
    },
    {
      "path": "/api/products/review/queue",
      "methods": [
        "GET"
      ],
      "source": "app/api/products/review/queue/route.ts:41"
    },
    {
      "path": "/api/products/review/status",
      "methods": [
        "GET"
      ],
      "source": "app/api/products/review/status/route.ts:13"
    },
    {
      "path": "/api/products",
      "methods": [
        "GET"
      ],
      "source": "app/api/products/route.ts:3"
    },
    {
      "path": "/api/purchase-orders/1688-check",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/purchase-orders/1688-check/route.ts:20"
    },
    {
      "path": "/api/purchase-orders/ai-match",
      "methods": [
        "POST"
      ],
      "source": "app/api/purchase-orders/ai-match/route.ts:167"
    },
    {
      "path": "/api/purchase-orders/product-media",
      "methods": [
        "POST",
        "PUT"
      ],
      "source": "app/api/purchase-orders/product-media/route.ts:119"
    },
    {
      "path": "/api/purchase-orders/rename-products",
      "methods": [
        "POST"
      ],
      "source": "app/api/purchase-orders/rename-products/route.ts:12"
    },
    {
      "path": "/api/purchase-orders/reorder-rank",
      "methods": [
        "POST"
      ],
      "source": "app/api/purchase-orders/reorder-rank/route.ts:70"
    },
    {
      "path": "/api/purchase-orders/suggest-names",
      "methods": [
        "POST"
      ],
      "source": "app/api/purchase-orders/suggest-names/route.ts:47"
    },
    {
      "path": "/api/region-overrides",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/region-overrides/route.ts:12"
    },
    {
      "path": "/api/rider-pois",
      "methods": [
        "GET",
        "POST",
        "PATCH",
        "DELETE"
      ],
      "source": "app/api/rider-pois/route.ts:5"
    },
    {
      "path": "/api/rider-stats",
      "methods": [
        "GET"
      ],
      "source": "app/api/rider-stats/route.ts:6"
    },
    {
      "path": "/api/scan-nic",
      "methods": [
        "POST"
      ],
      "source": "app/api/scan-nic/route.ts:14"
    },
    {
      "path": "/api/shop/localities",
      "methods": [
        "GET"
      ],
      "source": "app/api/shop/localities/route.ts:7"
    },
    {
      "path": "/api/shop/media",
      "methods": [
        "GET"
      ],
      "source": "app/api/shop/media/route.ts:24"
    },
    {
      "path": "/api/shop/order",
      "methods": [
        "POST"
      ],
      "source": "app/api/shop/order/route.ts:9"
    },
    {
      "path": "/api/stock-count/identify",
      "methods": [
        "POST"
      ],
      "source": "app/api/stock-count/identify/route.ts:23"
    },
    {
      "path": "/api/suppliers/products",
      "methods": [
        "POST",
        "DELETE"
      ],
      "source": "app/api/suppliers/products/route.ts:21"
    },
    {
      "path": "/api/suppliers/thread/[id]",
      "methods": [
        "GET"
      ],
      "source": "app/api/suppliers/thread/[id]/route.ts:7"
    },
    {
      "path": "/api/upload",
      "methods": [
        "POST"
      ],
      "source": "app/api/upload/route.ts:3"
    },
    {
      "path": "/api/upload-nic",
      "methods": [
        "POST"
      ],
      "source": "app/api/upload-nic/route.ts:3"
    },
    {
      "path": "/api/weather",
      "methods": [
        "GET"
      ],
      "source": "app/api/weather/route.ts:37"
    },
    {
      "path": "/api/webhooks/messenger",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/webhooks/messenger/route.ts:29"
    },
    {
      "path": "/api/webhooks/whatsapp",
      "methods": [
        "GET",
        "POST"
      ],
      "source": "app/api/webhooks/whatsapp/route.ts:20"
    },
    {
      "path": "/api/work-days",
      "methods": [
        "GET",
        "POST",
        "PUT"
      ],
      "source": "app/api/work-days/route.ts:5"
    }
  ],
  "roles": [
    {
      "id": "admin",
      "label": "Admin",
      "scope": "Administrative and operational navigation, including Users, Settings and Blueprint.",
      "evidence": "Defined role; sidebar lists admin-only entries. Settings and Users perform explicit admin checks. This is not a complete authorization audit.",
      "source": "components/dashboard/sidebar.tsx:249"
    },
    {
      "id": "manager",
      "label": "Manager",
      "scope": "Operational management, finance, purchasing, inventory, inbox, ads, team and planning; not the admin-only Users/Settings/Blueprint links.",
      "evidence": "Sidebar grants operational groups; requireBuyer allows admin or manager. Individual actions require separate authorization review.",
      "source": "lib/local-purchasing/auth.ts:5"
    },
    {
      "id": "marketing_agent",
      "label": "Marketing Agent",
      "scope": "Overview, entry activity, clients and tools in current navigation.",
      "evidence": "Current sidebar role lists. Scope describes navigation, not proof of every underlying action permission.",
      "source": "components/dashboard/sidebar.tsx:70"
    },
    {
      "id": "marketing_back_office",
      "label": "Marketing Back Office",
      "scope": "Back-office stock, sales, order creation, deliveries, clients and tools.",
      "evidence": "Back-office page allows this role or admin; sidebar defines the work area.",
      "source": "app/dashboard/marketing-back-office/page.tsx:18"
    },
    {
      "id": "marketing_front_office",
      "label": "Marketing Front Office",
      "scope": "Front-office order entry, clients, follow-up and tools; dashboard order queries filter by the signed-in creator.",
      "evidence": "Front-office page allows this role or admin and filters its order/follow-up queries by created_by.",
      "source": "app/dashboard/marketing-front-office/page.tsx:18"
    },
    {
      "id": "contractor",
      "label": "Contractor",
      "scope": "Linked contractor operations, riders, deliveries, collections, stock, earnings, accounting and wallet.",
      "evidence": "Contractor dashboard resolves profile linkage; wallet additionally checks role=contractor. Data scope and mutations are not interchangeable.",
      "source": "app/dashboard/contractors/wallet/page.tsx:20"
    },
    {
      "id": "rider",
      "label": "Rider",
      "scope": "Linked rider dashboard, deliveries, map, collections, stock and earnings.",
      "evidence": "Rider dashboard resolves a rider from profile_id or profile.rider_id; current sidebar lists rider work area.",
      "source": "app/dashboard/riders/page.tsx:23"
    },
    {
      "id": "storekeeper",
      "label": "Storekeeper",
      "scope": "Warehouse/store operations, cash collection, dispatch, returns, history and stock counts.",
      "evidence": "Storekeeper root checks storekeeper or admin. Sidebar is only part of the page/operation catalog.",
      "source": "app/dashboard/storekeeper/page.tsx:21"
    }
  ]
}


type BlueprintSkylineProps = {
  className?: string;
  "aria-hidden"?: boolean;
};

/** An original, static island panorama; its quiet left side leaves room for copy. */
function BlueprintSkyline({ className, "aria-hidden": hidden = true }: BlueprintSkylineProps) {
  const prefix = `blueprint-skyline-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = (name: string) => `${prefix}-${name}`;
  const paint = (name: string) => `url(#${id(name)})`;
  const towers = [
    { x: 1057, y: 177, w: 24, h: 47 }, { x: 1090, y: 145, w: 27, h: 76 },
    { x: 1126, y: 170, w: 21, h: 55 }, { x: 1154, y: 118, w: 34, h: 104 },
    { x: 1196, y: 161, w: 26, h: 65 }, { x: 1230, y: 185, w: 21, h: 44 },
  ];
  return (
    <svg className={className} viewBox="0 0 1400 360" fill="none" preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg" aria-hidden={hidden} focusable="false"
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : "A moonlit floating island with mountain terraces, a luminous city and pale cherry blossoms."}>
      <defs>
        <linearGradient id={id("sky")} x1="490" y1="160" x2="1400" y2="90" gradientUnits="userSpaceOnUse">
          <stop stopColor="#151C3D" stopOpacity="0" /><stop offset=".55" stopColor="#20284F" stopOpacity=".44" /><stop offset="1" stopColor="#27335B" stopOpacity=".72" />
        </linearGradient>
        <linearGradient id={id("reveal")} x1="440" y1="0" x2="950" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0" /><stop offset=".35" stopColor="white" stopOpacity=".12" /><stop offset="1" stopColor="white" />
        </linearGradient>
        <radialGradient id={id("moon-halo")}><stop stopColor="#A9BEFC" stopOpacity=".15" /><stop offset="1" stopColor="#A9BEFC" stopOpacity="0" /></radialGradient>
        <linearGradient id={id("moon")} x1="1197" y1="32" x2="1243" y2="101" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF4D9" /><stop offset="1" stopColor="#BACDE9" />
        </linearGradient>
        <linearGradient id={id("rock")} x1="1110" y1="239" x2="1110" y2="338" gradientUnits="userSpaceOnUse">
          <stop stopColor="#35445C" /><stop offset=".53" stopColor="#202B44" /><stop offset="1" stopColor="#11182E" stopOpacity=".15" />
        </linearGradient>
        <linearGradient id={id("land")} x1="999" y1="173" x2="1211" y2="267" gradientUnits="userSpaceOnUse">
          <stop stopColor="#435B62" /><stop offset=".45" stopColor="#274C56" /><stop offset="1" stopColor="#233A51" />
        </linearGradient>
        <linearGradient id={id("building")} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#78949F" /><stop offset=".48" stopColor="#465F76" /><stop offset="1" stopColor="#273951" />
        </linearGradient>
        <linearGradient id={id("falls")} x1="1043" y1="246" x2="1045" y2="326" gradientUnits="userSpaceOnUse">
          <stop stopColor="#99DFE7" stopOpacity=".6" /><stop offset="1" stopColor="#6F9FD4" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("mist")}><stop stopColor="#7C9BC5" stopOpacity=".16" /><stop offset="1" stopColor="#7C9BC5" stopOpacity="0" /></radialGradient>
        <mask id={id("scene")}><rect width="1400" height="360" fill={paint("reveal")} /></mask>
      </defs>
      <rect width="1400" height="360" fill={paint("sky")} />
      <g mask={paint("scene")}>
        <circle cx="1220" cy="67" r="113" fill={paint("moon-halo")} />
        <circle cx="1220" cy="67" r="31" fill={paint("moon")} />
        <path d="M1202 45c-13 20-8 42 11 51-26-5-36-34-11-51Z" fill="#B8CADE" opacity=".22" />
        <circle cx="1231" cy="53" r="6" fill="#9DAFC9" opacity=".14" />
        <g fill="#D6E5F9">
          {[[707,72],[764,122],[832,47],[919,85],[1028,34],[1072,69],[1131,42],[1308,36],[1365,104]].map(([x,y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.25 : .8} opacity={.25 + (i % 3) * .13} />
          ))}
        </g>
        <path d="m973 50 1.5 4.5L979 56l-4.5 1.5L973 62l-1.5-4.5L967 56l4.5-1.5Z" fill="#B8D4EB" opacity=".65" />
        <path d="M602 266 743 185 805 208 908 135 958 185 1049 107 1138 187 1206 153 1313 221 1400 177V360H602Z" fill="#25314C" opacity=".55" />
        <path d="M695 305 824 230 901 246 1027 199 1102 254 1187 214 1279 255 1400 211V360H695Z" fill="#1D2945" opacity=".7" />
        <path d="M718 279c177-41 294-24 436-40s188-11 270 5" stroke="#8EAAD0" strokeOpacity=".09" />
        <ellipse cx="1123" cy="327" rx="259" ry="30" fill={paint("mist")} />
        <path d="m783 231 24 10 36-2 18-16-31-6Z" fill="#344C60" />
        <path d="m791 237 17 35 14-10 12 5 20-33-28 7Z" fill={paint("rock")} />
        <path d="m795 229 26-11 28 7-21 8Z" fill="#4A6570" />
        <path d="M840 228c58 9 83-23 124-17" stroke="#ADD9DF" strokeOpacity=".35" strokeWidth="1.2" />
        <path d="M840 232c58 9 83-23 124-17" stroke="#678EA7" strokeOpacity=".22" />
        <path d="m921 238 35 36 30 10 27 34 26-10 25 28 31-30 43 15 33-21 31 7 30-34 48-18 27-25-44-18-276 5Z" fill={paint("rock")} />
        <path d="m955 250 32 33 26 35-8-43 19-23Zm112 2-3 83 31-30-9-49Zm98-1-27 69 33-22 21-47Zm71-1-4 23 48-18 18-18Z" fill="#516078" opacity=".21" />
        <path d="m927 238 27-19 53-11 42-3 48 7 52-10 43 9 47 6 42 21-37 20-46 4-36-6-55 9-52-11-57 4-45-10Z" fill={paint("land")} />
        <path d="m947 238 46-17 64-5 48 11 44-12 51 10 57 14-31 13-53-7-56 9-67-13-45 5Z" stroke="#88B5AD" strokeOpacity=".36" />
        <path d="m1040 250-2 34 5 41 7-1-2-42 3-30Z" fill={paint("falls")} />
        <path d="m972 217 6-37 15-5 8-24 24 3 10 29 14 30-24 11Z" fill="#354D5B" />
        <path d="m993 175 8-24 24 3-5 26 15 33-22 9 1-34Z" fill="#536971" opacity=".62" />
        <path d="m1003 153 21 2 9 25-15-7Z" fill="#6A8582" opacity=".48" />
        <path d="M965 228c26-11 46-10 59-5s16 10 34 11" stroke="#95BAA5" strokeOpacity=".4" />
        <g stroke="#BBCAD5" strokeOpacity=".17" strokeWidth=".8">
          {towers.map(({x,y,w,h}, i) => (
            <g key={x}>
              <path d={`M${x} ${y}l${w*.65} -5 ${w*.35} 6v${h}l-${w*.35} 4-${w*.65} -5Z`} fill={paint("building")} />
              <path d={`M${x+w*.65} ${y-5}v${h+10}l${w*.35} -4V${y+1}Z`} fill="#20354D" opacity=".7" />
              <path d={`M${x+4} ${y+2}h${w*.45}`} stroke="#BAE3E8" strokeOpacity=".55" />
              {Array.from({length: Math.floor(h/11)}, (_, row) => (
                <g key={row} fill={row % 3 === i % 3 ? "#EFCEA1" : "#9CCFD2"} stroke="none" opacity={row % 3 === i % 3 ? .85 : .37}>
                  <rect x={x+5} y={y+9+row*10} width="3" height="3" rx=".5" />
                  <rect x={x+11} y={y+9+row*10} width="3" height="3" rx=".5" />
                </g>
              ))}
            </g>
          ))}
        </g>
        <path d="M1169 114V96m-6 20h15" stroke="#9AC9D6" strokeOpacity=".65" />
        <circle cx="1169" cy="95" r="1.6" fill="#EFCEA1" />
        <path d="m1091 231 14-7 22 6 16-3 34 7 35-5 21 9-38 9-32-6-29 4-22-9Z" fill="#648087" opacity=".45" />
        <path d="M1080 239c40 15 102 13 146-1m-119 1 36-13 42 14" stroke="#B9D6D4" strokeWidth="1.1" strokeOpacity=".6" />
        <g fill="#F3D6A4">
          {[[1086,240],[1113,246],[1151,247],[1189,244],[1224,238],[967,236],[832,228]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />)}
        </g>
        <path d="M1263 237c1-15-4-24-4-37m3 19 16-12m-17 3-14-11m13 6 6-18" stroke="#907B91" strokeWidth="2" strokeLinecap="round" />
        <g fill="#D4AAC8" opacity=".8">
          <ellipse cx="1250" cy="196" rx="12" ry="6" /><ellipse cx="1267" cy="185" rx="14" ry="7" />
          <ellipse cx="1280" cy="203" rx="13" ry="6" /><ellipse cx="1261" cy="198" rx="18" ry="7" />
        </g>
        <g fill="#E7C7D8" opacity=".8"><circle cx="1244" cy="195" r="2" /><circle cx="1262" cy="182" r="2" /><circle cx="1278" cy="199" r="2" /></g>
        <path d="m1295 199 5-2-2 5Zm18 20 5 1-4 3Zm-14 16 4-2-1 4Z" fill="#D7B6D1" opacity=".57" />
        <path d="M1190 289c54-7 134-5 194 2M905 303c41-5 79-4 104 1" stroke="#91AFCC" strokeOpacity=".12" />
      </g>
    </svg>
  );
}

const blueprintCSS = `
.akz-bp {max-width:1440px;margin-inline:auto;
  box-sizing: border-box;
  --bp-bg: #101624;
  --bp-panel: #171f31;
  --bp-raised: #1c273b;
  --bp-text: #f2eee5;
  --bp-muted: #b9c2d3;
  --bp-dim: #a3b0c7;
  --bp-line: #35415a;
  --bp-jade: #b1dcc5;
  --bp-amber: #e8c68e;
  --bp-radius: 18px;
  width: 100%;
  min-width: 0;
  color: var(--bp-text);
  background: var(--bp-bg);
  border: 1px solid #2a354c;
  border-radius: 24px;
  padding: 20px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.55;
  color-scheme: dark;
  isolation: isolate;
  -webkit-font-smoothing: antialiased;
}
.akz-bp *, .akz-bp *::before, .akz-bp *::after { box-sizing: border-box; }
.akz-bp button, .akz-bp input, .akz-bp select { font: inherit; }
.akz-bp button, .akz-bp a, .akz-bp input, .akz-bp select { -webkit-tap-highlight-color: transparent; }
.akz-bp button { color: inherit; }
.akz-bp button:not(:disabled), .akz-bp select { cursor: pointer; }
.akz-bp button:disabled { cursor: not-allowed; opacity: .55; }
.akz-bp button, .akz-bp a, .akz-bp input, .akz-bp select, .akz-bp summary { touch-action: manipulation; }
.akz-bp :focus-visible { outline: 3px solid #bee6ce; outline-offset: 4px; }
.akz-bp [hidden] { display: none !important; }
.akz-bp svg { flex-shrink: 0; }
.akz-bp ::selection { background: #456456; color: #fffaf0; }
.akz-bp .bp-hero {
  position: relative; overflow: hidden; min-height: 306px; border: 1px solid #35415c;
  border-radius: 19px; background: linear-gradient(118deg, #182337 0%, #151e32 48%, #1c2643 100%);
}
.akz-bp .bp-skyline { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.akz-bp .bp-hero-content { position: relative; z-index: 1; max-width: 660px; padding: 34px 38px 30px; }
.akz-bp .bp-hero-content > .bp-btn { margin-top: 21px; }
.akz-bp .bp-eyebrow, .akz-bp .bp-kicker {
  display: flex; align-items: center; gap: 9px; color: var(--bp-jade);
  font-size: 10px; font-weight: 700; letter-spacing: .16em; line-height: 1.5; text-transform: uppercase;
}
.akz-bp .bp-eyebrow { margin: 0 0 15px; }
.akz-bp .bp-title { margin: 0; max-width: 20ch; font-size: clamp(30px, 3.9vw, 46px); line-height: 1.12; letter-spacing: -.045em; font-weight: 650; text-wrap: balance; }
.akz-bp .bp-title > span { color: #d6e1ee; font-size: .76em; font-weight: 450; letter-spacing: -.035em; line-height: 1.3; }
.akz-bp .bp-subtitle { max-width: 49ch; margin: 15px 0 0; color: #c6cddb; font-size: 14px; line-height: 1.7; }
.akz-bp .bp-hero-meta { position: relative; z-index: 1; display: flex; align-items: flex-start; flex-wrap: wrap; gap: 15px 26px; margin: 0; padding: 18px 38px; border-top: 1px solid #52617a70; background: #111b2a73; }
.akz-bp .bp-stat { display: flex; flex-direction: column; gap: 2px; min-width: 74px; }
.akz-bp .bp-stat + .bp-stat { padding-left: 24px; border-left: 1px solid #4b576f; }
.akz-bp .bp-stat-number { color: var(--bp-text); font-size: 24px; font-weight: 600; line-height: 1.2; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.akz-bp .bp-stat-label { color: #bbc5d7; font-size: 10px; letter-spacing: .04em; }
.akz-bp .bp-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 22px 0 18px; }
.akz-bp .bp-search { position: relative; display: block; flex: 1 1 260px; width: 100%; min-width: 0; max-width: 520px; }
.akz-bp .bp-search > svg { position: absolute; left: 14px; top: 50%; width: 17px; height: 17px; transform: translateY(-50%); color: var(--bp-dim); pointer-events: none; }
.akz-bp .bp-search-input {
  width: 100%; min-height: 44px; padding: 10px 44px 10px 42px; color: var(--bp-text);
  background: #151e30; border: 1px solid #43506a; border-radius: 11px; outline-offset: 3px;
}
.akz-bp .bp-search-input::placeholder { color: #a5b0c5; opacity: 1; }
.akz-bp .bp-search-input:focus { border-color: var(--bp-jade); }
.akz-bp .bp-search > button.bp-btn { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 32px; height: 32px; min-height: 32px; padding: 0; border: 0; border-radius: 7px; background: transparent; }
.akz-bp .bp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px;
  max-width: 100%; padding: 10px 14px; border: 1px solid #4b5870; border-radius: 10px;
  color: #e2e6ee; background: #1b263a; font-size: 12px; font-weight: 600; line-height: 1.35;
  text-decoration: none; text-align: center; transition: background-color .16s, border-color .16s;
}
.akz-bp .bp-btn > svg { width: 15px; height: 15px; }
.akz-bp .bp-btn-primary { border-color: #b1dcc5; background: #b1dcc5; color: #142a23; }
.akz-bp .bp-btn.bp-active, .akz-bp .bp-btn[aria-pressed="true"] { border-color: #73957f; background: #2a4236; color: #d5efde; }
.akz-bp .bp-tabs {
  display: flex; gap: 6px; overflow-x: auto; padding: 0 0 9px; margin: 0 0 25px;
  border-bottom: 1px solid var(--bp-line); scrollbar-width: thin; scrollbar-color: #4d6079 transparent;
}
.akz-bp .bp-tab {
  position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 1 0 auto;
  gap: 8px; min-height: 44px; padding: 10px 13px; border: 1px solid transparent; border-radius: 9px;
  background: transparent; color: #b9c4d6; font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: background-color .16s, color .16s;
}
.akz-bp .bp-tab > svg { width: 15px; height: 15px; }
.akz-bp .bp-tab.bp-active, .akz-bp .bp-tab[aria-selected="true"] { background: #27392f; border-color: #466758; color: #c6ecd4; }
.akz-bp .bp-panel { min-width: 0; }
.akz-bp .bp-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.akz-bp .bp-section-head > div { min-width: 0; }
.akz-bp .bp-section-head > div:first-child { flex: 1; }
.akz-bp .bp-section-head > .bp-muted { flex: 0 1 330px; margin: 0; padding-top: 5px; }
.akz-bp .bp-section-head .bp-muted { max-width: 68ch; margin: 8px 0 0; }
.akz-bp .bp-grid + .bp-section-head { margin-top: 33px; }
.akz-bp .bp-kicker { margin: 0 0 7px; color: #e4c493; }
.akz-bp .bp-heading { margin: 0; font-size: clamp(21px, 2.5vw, 27px); font-weight: 600; letter-spacing: -.03em; line-height: 1.25; text-wrap: balance; }
.akz-bp .bp-muted { color: var(--bp-muted); font-size: 12px; line-height: 1.65; }
.akz-bp .bp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; }
.akz-bp .bp-journey { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 20px 0 30px; padding: 2px 0; }
.akz-bp .bp-journey-step { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; min-height: 117px; padding: 17px 15px; border: 1px solid #4c665d; border-radius: 12px; background: linear-gradient(145deg, #24382f, #1a2831); color: #e5eee6; text-align: left; line-height: 1.45; }
.akz-bp .bp-journey-step > svg:first-child { width: 19px; height: 19px; color: #b5d9c2; }
.akz-bp .bp-journey-step strong, .akz-bp .bp-journey-step .bp-card-title { display: block; font-size: 13px; font-weight: 550; letter-spacing: -.01em; }
.akz-bp .bp-journey-step .bp-small, .akz-bp .bp-journey-step .bp-kicker { margin: 0; color: #b5d3be; font-size: 10px; }
.akz-bp .bp-journey-step:not(:last-child)::after { content: ""; position: absolute; z-index: 2; top: 50%; right: -7px; width: 6px; height: 6px; border-top: 1px solid #b7d8c3; border-right: 1px solid #b7d8c3; transform: translateY(-50%) rotate(45deg); pointer-events: none; }
.akz-bp .bp-journey-step:has(.bp-journey-arrow)::after, .akz-bp .bp-journey-step:has(.bp-kicker > svg)::after { display: none; }
.akz-bp .bp-journey-arrow, .akz-bp .bp-journey-step > .bp-kicker > svg { position: absolute; z-index: 2; top: 50%; right: -11px; width: 14px; height: 14px; transform: translateY(-50%); border-radius: 5px; background: #101624; color: #badbc7; pointer-events: none; }
.akz-bp .bp-card {
  position: relative; min-width: 0; padding: 20px; border: 1px solid #36425b; border-radius: var(--bp-radius);
  background: linear-gradient(140deg, #1b2539, #172031 80%); color: var(--bp-text); text-align: left;
}
.akz-bp .bp-card > :first-child { margin-top: 0; }
.akz-bp .bp-card > :last-child { margin-bottom: 0; }
.akz-bp .bp-card .bp-muted { margin: 9px 0 14px; }
.akz-bp .bp-card > .bp-tag + .bp-card-title { margin-top: 13px; }
.akz-bp .bp-card-title + .bp-tag { margin-top: 11px; }
.akz-bp .bp-card h4, .akz-bp .bp-detail-block h3, .akz-bp .bp-dialog-body > h3 { margin: 20px 0 9px; color: #eeeae3; font-size: 12px; font-weight: 650; line-height: 1.5; }
.akz-bp .bp-detail-block > h3:first-child, .akz-bp .bp-detail-block > h4:first-child { margin-top: 0; }
.akz-bp .bp-dialog-body > h3 { margin-top: 25px; font-size: 13px; }
.akz-bp .bp-card p:not([class]), .akz-bp .bp-dialog-body > p:not([class]) { margin: 10px 0 15px; color: #c6d0df; font-size: 12px; line-height: 1.7; }
.akz-bp .bp-card > .bp-btn { margin-top: 16px; }
.akz-bp .bp-card > button.bp-link { min-height: 40px; margin-top: 12px; padding: 0; border: 0; background: transparent; text-align: left; }
.akz-bp .bp-card details { margin-top: 17px; padding-top: 12px; border-top: 1px solid #3a4760; }
.akz-bp .bp-card summary.bp-link { display: list-item; min-height: 36px; margin-left: 17px; padding-block: 6px; cursor: pointer; }
.akz-bp .bp-group-card {
  --bp-area: #b6d7c5; --bp-area-bg: #263e37;
  display: flex; align-items: flex-start; flex-direction: column; min-height: 190px; width: 100%;
  padding: 21px; border-top: 2px solid var(--bp-area); transition: border-color .16s, background-color .16s, transform .16s;
}
.akz-bp .bp-grid > .bp-group-card:nth-child(7) { grid-column: 1 / -1; min-height: 146px; }
.akz-bp .bp-group-card .bp-muted { max-width: 61ch; }
.akz-bp .bp-group-card > .bp-small { margin-bottom: 6px; font-size: 10px; letter-spacing: .025em; }
.akz-bp .bp-group-card .bp-link { margin-top: auto; }
.akz-bp .bp-group-icon { display: inline-flex; align-items: center; justify-content: center; width: 35px; height: 35px; margin-bottom: 16px; border: 1px solid #637082; border-radius: 10px; color: var(--bp-area); background: var(--bp-area-bg); }
.akz-bp .bp-group-icon svg { width: 17px; height: 17px; }
.akz-bp .bp-card-title { margin: 0; color: var(--bp-text); font-size: 16px; font-weight: 600; letter-spacing: -.015em; line-height: 1.35; }
.akz-bp .bp-count { display: inline-flex; align-items: center; justify-content: center; min-width: 25px; min-height: 24px; padding: 2px 7px; border: 1px solid #526078; border-radius: 7px; color: #d8dfeb; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
.akz-bp .bp-group-card > .bp-count { position: absolute; top: 23px; right: 21px; }
.akz-bp .bp-link { display: inline-flex; align-items: center; gap: 7px; color: var(--bp-jade); font-size: 12px; font-weight: 600; text-decoration: none; text-underline-offset: 4px; }
.akz-bp .bp-link svg { width: 14px; height: 14px; }
.akz-bp a.bp-link { text-decoration: underline; text-decoration-color: #719b83; }
.akz-bp .bp-tag { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 4px 8px; border: 1px solid #526079; border-radius: 6px; background: #263249; color: #d6dfea; font-size: 10px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
.akz-bp .bp-tag svg { width: 12px; height: 12px; }
.akz-bp .bp-tag[data-tone="jade"] { color: #c0e7cf; border-color: #4b7660; background: #243c32; }
.akz-bp .bp-tag[data-tone="amber"] { color: #f0d39f; border-color: #87714a; background: #3b3329; }
.akz-bp .bp-tag[data-tone="rose"] { color: #ebc1cf; border-color: #805969; background: #3d2d3b; }
.akz-bp .bp-tag[data-tone="slate"] { color: #d6dfea; border-color: #526079; background: #263249; }
.akz-bp .bp-list { overflow: hidden; margin: 0; padding: 0; list-style: none; border: 1px solid #3a4660; border-radius: 15px; background: #151e2f; }
.akz-bp .bp-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 17px 19px; border: 0; border-bottom: 1px solid #303d55; background: transparent; text-align: left; text-decoration: none; }
.akz-bp .bp-row:last-child { border-bottom: 0; }
.akz-bp .bp-row-main { display: block; flex: 1; min-width: 0; }
.akz-bp .bp-row-main > .bp-small { display: block; margin: 5px 0 0; }
.akz-bp .bp-row-main > svg { display: block; margin-top: 7px; color: #9bb8ac; }
.akz-bp .bp-row-main > code { display: block; color: #c4e0d1; font-size: 11px; overflow-wrap: anywhere; }
.akz-bp .bp-row > .bp-tag { flex-shrink: 0; }
.akz-bp .bp-card > .bp-row { padding: 14px 0; }
.akz-bp .bp-list > .bp-kicker { margin: 0; padding: 16px 18px; border-bottom: 1px solid #34445e; background: #1e2a3f; }
.akz-bp .bp-row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin: 0; color: #f0ece4; font-size: 13px; font-weight: 600; line-height: 1.45; }
.akz-bp .bp-row-desc { display: block; margin: 5px 0 0; max-width: 76ch; color: #b6c1d3; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.akz-bp .bp-row > svg { width: 17px; height: 17px; color: #acc8b9; }
.akz-bp .bp-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 9px; margin-bottom: 16px; }
.akz-bp .bp-filters > label { display: flex; flex-direction: column; gap: 5px; min-width: 170px; font-size: 11px; }
.akz-bp .bp-panel > label.bp-small { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 9px; margin-bottom: 19px; font-size: 11px; }
.akz-bp .bp-filters .bp-muted { margin-left: auto; }
.akz-bp .bp-select { min-height: 42px; max-width: 100%; padding: 9px 32px 9px 12px; border: 1px solid #4c5b73; border-radius: 9px; background: #1c273b; color: #e5e8ef; font-size: 11px; }
.akz-bp .bp-select option { color: #f0ede5; background: #1c273b; }
.akz-bp .bp-empty { padding: 45px 22px; border: 1px dashed #53617a; border-radius: 15px; color: #bdc9da; text-align: center; font-size: 13px; line-height: 1.7; }
.akz-bp .bp-empty > svg { display: block; margin: 0 auto 14px; color: #a6b7d0; }
.akz-bp .bp-split { display: grid; grid-template-columns: minmax(255px, 1.1fr) minmax(0, 1.7fr); gap: 23px; align-items: start; }
.akz-bp .bp-flow-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; padding: 0; margin: 0 0 26px; list-style: none; }
.akz-bp .bp-flow-button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 54px; padding: 12px 14px; border: 1px solid #3b4861; border-radius: 11px; background: #182235; color: #c7d0df; text-align: left; font-size: 12px; line-height: 1.45; }
.akz-bp .bp-flow-button svg { width: 16px; height: 16px; }
.akz-bp .bp-flow-button > .bp-small { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 23px; height: 23px; border: 1px solid #52617b; border-radius: 6px; color: #ccd7e7; background: #26354b; }
.akz-bp .bp-flow-button.bp-active, .akz-bp .bp-flow-button[aria-pressed="true"] { border-color: #63866f; background: #263b32; color: #d4eedb; box-shadow: inset 3px 0 0 #b1dcc5; }
.akz-bp .bp-flow-steps { display: flex; flex-direction: column; gap: 9px; padding: 0; margin: 0; list-style: none; }
.akz-bp .bp-step { position: relative; display: grid; grid-template-columns: 31px minmax(0, 1fr) 16px; align-items: center; gap: 12px; width: 100%; min-height: 77px; padding: 14px; border: 1px solid #42516b; border-radius: 12px; background: #192538; color: #c5cfdf; text-align: left; line-height: 1.5; }
.akz-bp .bp-step.bp-active, .akz-bp .bp-step[aria-pressed="true"] { border-color: #73927c; background: #263c32; box-shadow: inset 3px 0 0 #b1dcc5; }
.akz-bp .bp-step-number { display: flex; align-items: center; justify-content: center; width: 31px; height: 31px; border: 1px solid #607089; border-radius: 9px; color: #cedbec; background: #2b3a50; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.akz-bp .bp-step.bp-active .bp-step-number { border-color: #789981; color: #e0f1e5; background: #365743; }
.akz-bp .bp-step-content { display: block; min-width: 0; padding: 0; }
.akz-bp .bp-step-content > strong { display: block; color: #edece5; font-size: 12px; font-weight: 550; line-height: 1.5; }
.akz-bp .bp-step-content > .bp-small { display: block; margin-top: 5px; }
.akz-bp .bp-step > svg { color: #afc2b8; }
.akz-bp .bp-step-content .bp-row-title { font-size: 13px; }
.akz-bp .bp-step-content .bp-muted { margin: 7px 0 0; }
.akz-bp .bp-step-content .bp-tag { margin-top: 9px; }
.akz-bp .bp-branch { margin: 13px 0 0; padding: 10px 13px; border-left: 2px solid #d6b47b; border-radius: 0 9px 9px 0; background: #302f2c; color: #ead4b1; font-size: 11px; line-height: 1.65; }
.akz-bp .bp-step.bp-branch { margin: 0; padding: 14px; border: 1px solid #88724e; border-left: 3px solid #d6b47b; border-radius: 12px; background: #302e2b; }
.akz-bp .bp-step.bp-branch .bp-step-number { border-color: #8a784f; color: #efd6ad; background: #4a3e2d; }
.akz-bp .bp-step.bp-branch.bp-active { border-color: #e6c48b; background: #453a2c; box-shadow: none; }
.akz-bp .bp-callout { display: flex; align-items: flex-start; gap: 12px; margin: 20px 0; padding: 16px 18px; border: 1px solid #716044; border-radius: 12px; background: #2b2a28; color: #e6d3b1; font-size: 12px; line-height: 1.65; }
.akz-bp .bp-callout > svg { width: 17px; height: 17px; margin-top: 2px; color: #e8c68e; }
.akz-bp .bp-callout p { margin: 0; }
.akz-bp .bp-dialog {
  position: fixed; inset: 0; width: min(880px, calc(100vw - 40px)); max-width: none;
  max-height: min(88dvh, 920px); height: fit-content; margin: auto; padding: 0;
  border: 1px solid #617087; border-radius: 20px; background: #141e30; color: #f2eee5;
  box-shadow: 0 28px 100px #0009; overscroll-behavior: contain;
}
.akz-bp .bp-dialog[open], .akz-bp .bp-dialog[role="dialog"] { display: flex; flex-direction: column; }
.akz-bp .bp-dialog::backdrop { background: #080d18c9; backdrop-filter: blur(7px); }
.akz-bp .bp-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; gap: 20px; padding: 25px 28px 21px; border-bottom: 1px solid #3a4860; background: #1a2539; }
.akz-bp .bp-dialog-head .bp-heading { max-width: 30ch; font-size: 25px; }
.akz-bp .bp-dialog-head .bp-muted { margin: 9px 0 0; }
.akz-bp .bp-dialog-body { min-height: 0; overflow-y: auto; padding: 25px 28px 28px; scrollbar-width: thin; scrollbar-color: #64758e #182135; }
.akz-bp .bp-dialog-close { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 42px; height: 42px; padding: 0; border: 1px solid #5e6a81; border-radius: 11px; color: #e9e7e1; background: #27334a; }
.akz-bp .bp-dialog-close svg { width: 19px; height: 19px; }
.akz-bp .bp-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; margin: 18px 0; }
.akz-bp .bp-detail-block { min-width: 0; padding: 17px; border: 1px solid #3c4962; border-radius: 12px; background: #1b2538; }
.akz-bp .bp-detail-block .bp-card-title { font-size: 13px; }
.akz-bp .bp-detail-block .bp-muted { margin: 8px 0 0; }
.akz-bp .bp-bullet-list { display: grid; gap: 9px; margin: 12px 0 0; padding-left: 18px; color: #c7d1df; font-size: 12px; line-height: 1.65; }
.akz-bp .bp-bullet-list li { padding-left: 3px; overflow-wrap: anywhere; }
.akz-bp .bp-bullet-list li::marker { color: #b1dcc5; }
.akz-bp .bp-role-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 21px; }
.akz-bp .bp-role-button { display: flex; flex-direction: column; align-items: flex-start; gap: 11px; min-width: 0; min-height: 92px; padding: 16px; border: 1px solid #46536b; border-radius: 12px; background: #1a2539; color: #d4dce7; text-align: left; font-size: 12px; line-height: 1.45; }
.akz-bp .bp-role-button svg { width: 19px; height: 19px; color: #b3c4de; }
.akz-bp .bp-role-button.bp-active, .akz-bp .bp-role-button[aria-pressed="true"] { border-color: #6f907b; background: #263c32; color: #dbefdf; }
.akz-bp .bp-role-button.bp-active svg, .akz-bp .bp-role-button[aria-pressed="true"] svg { color: #bee4ca; }
.akz-bp .bp-registry { overflow-x: auto; margin-top: 17px; border: 1px solid #3a4961; border-radius: 14px; background: #151f31; }
.akz-bp .bp-registry table { width: 100%; border-collapse: collapse; text-align: left; font-size: 11px; }
.akz-bp .bp-registry th { padding: 13px 16px; border-bottom: 1px solid #4a5871; background: #222e43; color: #d8e0ed; font-size: 10px; font-weight: 600; letter-spacing: .035em; text-align: left; white-space: nowrap; }
.akz-bp .bp-registry td { padding: 13px 16px; border-bottom: 1px solid #303f58; color: #c8d3e4; vertical-align: top; line-height: 1.65; }
.akz-bp .bp-registry tr:last-child td { border-bottom: 0; }
.akz-bp .bp-registry td:first-child { color: #ede9e1; font-weight: 500; }
.akz-bp .bp-registry code, .akz-bp .bp-route-row code { color: #b8dbcd; font-size: 11px; overflow-wrap: anywhere; }
.akz-bp .bp-route-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; min-width: 0; padding: 11px 0; border-bottom: 1px solid #344159; font-size: 11px; }
.akz-bp .bp-route-row:last-child { border-bottom: 0; }
.akz-bp .bp-registry > .bp-route-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(70px, .6fr) minmax(0, 1fr); align-items: start; gap: 12px; padding: 14px 16px; }
.akz-bp .bp-registry > .bp-route-row > .bp-small:last-child:nth-child(2) { grid-column: 2 / -1; }
.akz-bp .bp-registry > .bp-route-row > span:not(.bp-small) { display: flex; flex-wrap: wrap; gap: 4px; }
.akz-bp .bp-route-row > .bp-small { overflow-wrap: anywhere; }
.akz-bp .bp-route-row a { min-width: 0; color: #bfdcca; text-decoration: underline; text-underline-offset: 4px; overflow-wrap: anywhere; }
.akz-bp .bp-footer { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; margin-top: 29px; padding: 17px 2px 0; border-top: 1px solid var(--bp-line); color: var(--bp-dim); font-size: 10px; line-height: 1.65; }
.akz-bp .bp-footer p { margin: 0; }
.akz-bp .bp-small { color: #bac5d7; font-size: 10px; line-height: 1.7; }
.akz-bp .bp-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin: 16px 0; color: #bfc9da; font-size: 10px; line-height: 1.65; }
.akz-bp .bp-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.akz-bp .bp-legend svg { width: 12px; height: 12px; }
.akz-bp .bp-accent { color: var(--bp-jade); }
.akz-bp .bp-metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
.akz-bp .bp-metric-grid .bp-stat { min-width: 0; padding: 17px; border: 1px solid #3d4a64; border-radius: 12px; background: #1b2538; }
.akz-bp .bp-metric-grid .bp-stat-label { margin-top: 5px; line-height: 1.55; }
.akz-bp .bp-area-1 { --bp-area: #cbb4df; --bp-area-bg: #393046; }
.akz-bp .bp-area-2 { --bp-area: #e7bf9f; --bp-area-bg: #42352e; }
.akz-bp .bp-area-3 { --bp-area: #a8cee4; --bp-area-bg: #283d50; }
.akz-bp .bp-area-4 { --bp-area: #b0d4b9; --bp-area-bg: #2a4037; }
.akz-bp .bp-area-5 { --bp-area: #e3cd94; --bp-area-bg: #403a29; }
.akz-bp .bp-area-6 { --bp-area: #dcb8c6; --bp-area-bg: #40313f; }
.akz-bp .bp-area-7 { --bp-area: #b9c8e2; --bp-area-bg: #303b52; }
@media (hover: hover) {
  .akz-bp .bp-btn:hover { border-color: #8596af; background: #2a3850; }
  .akz-bp .bp-btn-primary:hover { border-color: #c8ead8; background: #c8ead8; }
  .akz-bp .bp-btn.bp-active:hover { border-color: #afd3bb; background: #345241; }
  .akz-bp .bp-tab:hover { color: #efede7; background: #263349; }
  .akz-bp .bp-tab.bp-active:hover { background: #304c3d; color: #e0f2e5; }
  .akz-bp .bp-group-card:hover { transform: translateY(-2px); border-color: var(--bp-area); background: #202c40; }
  .akz-bp .bp-journey-step:hover { border-color: #a7cdb4; background: #2b4238; }
  .akz-bp button.bp-row:hover, .akz-bp a.bp-row:hover { background: #223149; }
  .akz-bp .bp-link:hover { color: #dbf0e2; text-decoration: underline; }
  .akz-bp .bp-flow-button:hover, .akz-bp .bp-role-button:hover { border-color: #7b8b9e; background: #29384a; }
  .akz-bp .bp-flow-button.bp-active:hover, .akz-bp .bp-role-button.bp-active:hover { border-color: #a8c7b1; background: #2f4b3c; }
  .akz-bp .bp-step:hover { border-color: #8ba292; background: #263c3b; }
  .akz-bp .bp-step.bp-active:hover { border-color: #b7d7c1; background: #2e4a3a; }
  .akz-bp .bp-step.bp-branch:hover { border-color: #e1c18d; background: #44382b; }
  .akz-bp .bp-dialog-close:hover { border-color: #a5b1c4; background: #35435b; }
  .akz-bp .bp-registry tbody tr:hover { background: #1d2b41; }
}
@media (min-width: 1400px) {
  .akz-bp .bp-hero-content { padding-left: 44px; }
  .akz-bp .bp-hero-meta { padding-left: 44px; }
  .akz-bp .bp-grid { gap: 16px; }
}
@media (max-width: 1000px) {
  .akz-bp { padding: 17px; }
  .akz-bp .bp-hero-content { max-width: 600px; padding: 30px; }
  .akz-bp .bp-hero-meta { padding: 17px 30px; }
  .akz-bp .bp-title { font-size: 36px; }
  .akz-bp .bp-skyline { left: -15%; width: 115%; opacity: .75; }
  .akz-bp .bp-tab { padding-inline: 11px; }
  .akz-bp .bp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .akz-bp .bp-role-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .akz-bp .bp-split { grid-template-columns: minmax(220px, 1.1fr) minmax(0, 1.7fr); gap: 17px; }
}
@media (max-width: 700px) {
  .akz-bp { padding: 14px; border-radius: 19px; }
  .akz-bp .bp-hero { min-height: 308px; border-radius: 14px; }
  .akz-bp .bp-hero-content { padding: 25px; }
  .akz-bp .bp-title { max-width: 16ch; font-size: 33px; }
  .akz-bp .bp-subtitle { max-width: 38ch; font-size: 12px; }
  .akz-bp .bp-skyline { left: -52%; top: 0; width: 152%; opacity: .32; }
  .akz-bp .bp-hero-meta { gap: 14px; padding: 16px 25px; }
  .akz-bp .bp-stat + .bp-stat { padding-left: 14px; }
  .akz-bp .bp-toolbar { gap: 10px; margin-block: 16px; }
  .akz-bp .bp-search { flex-basis: 100%; max-width: none; }
  .akz-bp .bp-tabs { gap: 5px; margin-bottom: 21px; }
  .akz-bp .bp-tab { flex: 0 0 auto; min-height: 43px; padding-inline: 12px; font-size: 11px; }
  .akz-bp .bp-section-head { flex-direction: column; gap: 12px; }
  .akz-bp .bp-section-head > .bp-muted { flex: initial; margin: 0; padding: 0; }
  .akz-bp .bp-heading { font-size: 23px; }
  .akz-bp .bp-card { padding: 17px; border-radius: 13px; }
  .akz-bp .bp-group-card { min-height: 185px; }
  .akz-bp .bp-group-card > .bp-count { top: 20px; right: 17px; }
  .akz-bp .bp-card-title { font-size: 14px; }
  .akz-bp .bp-journey { grid-template-columns: repeat(5, minmax(140px, 1fr)); overflow-x: auto; margin-block: 18px 26px; padding: 3px 3px 12px; scrollbar-width: thin; scrollbar-color: #708979 #142033; scroll-snap-type: x proximity; }
  .akz-bp .bp-journey-step { scroll-snap-align: start; }
  .akz-bp .bp-journey-step:focus-visible { outline-offset: -4px; }
  .akz-bp .bp-split { grid-template-columns: minmax(0, 1fr); gap: 21px; }
  .akz-bp .bp-flow-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .akz-bp .bp-flow-button { height: 100%; min-height: 57px; padding: 11px; font-size: 11px; }
  .akz-bp .bp-role-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .akz-bp .bp-role-button { min-height: 85px; padding: 14px; }
  .akz-bp .bp-metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .akz-bp .bp-row { align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 15px; }
  .akz-bp .bp-row-main { flex-basis: 100%; }
  .akz-bp .bp-row > .bp-tag { margin-left: 0; }
  .akz-bp .bp-filters { align-items: stretch; }
  .akz-bp .bp-filters > .bp-select, .akz-bp .bp-filters > label { flex: 1 1 160px; min-width: 0; }
  .akz-bp .bp-filters > label .bp-select { flex: 0 0 auto; width: 100%; }
  .akz-bp .bp-filters .bp-muted { flex-basis: 100%; margin-left: 0; }
  .akz-bp .bp-dialog { width: calc(100vw - 24px); max-height: 92dvh; border-radius: 16px; }
  .akz-bp .bp-dialog-head { gap: 12px; padding: 20px; }
  .akz-bp .bp-dialog-head .bp-heading { font-size: 22px; }
  .akz-bp .bp-dialog-body { padding: 20px; }
  .akz-bp .bp-detail-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .akz-bp .bp-route-row { flex-direction: column; gap: 6px; }
  .akz-bp .bp-registry > .bp-route-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .akz-bp .bp-registry > .bp-route-row > .bp-small:last-child:nth-child(2) { grid-column: auto; }
  .akz-bp .bp-registry th, .akz-bp .bp-registry td { padding: 11px 12px; }
  .akz-bp .bp-callout { padding: 13px; font-size: 11px; }
}
@media (max-width: 460px) {
  .akz-bp { padding: 10px; border-radius: 15px; }
  .akz-bp .bp-hero-content { padding: 22px 18px; }
  .akz-bp .bp-eyebrow { font-size: 9px; letter-spacing: .11em; }
  .akz-bp .bp-title { font-size: 30px; }
  .akz-bp .bp-subtitle { font-size: 12px; line-height: 1.65; }
  .akz-bp .bp-stat { min-width: 56px; }
  .akz-bp .bp-stat-number { font-size: 22px; }
  .akz-bp .bp-stat-label { max-width: 78px; font-size: 9px; }
  .akz-bp .bp-hero-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px 14px; padding: 17px 18px; }
  .akz-bp .bp-hero-meta .bp-stat + .bp-stat { padding-left: 0; border-left: 0; }
  .akz-bp .bp-hero-meta .bp-stat-label { max-width: none; font-size: 10px; }
  .akz-bp .bp-metric-grid { gap: 7px; }
  .akz-bp .bp-metric-grid .bp-stat { padding: 13px 9px; }
  .akz-bp .bp-grid { grid-template-columns: minmax(0, 1fr); gap: 11px; }
  .akz-bp .bp-group-card, .akz-bp .bp-grid > .bp-group-card:nth-child(7) { min-height: 163px; }
  .akz-bp .bp-group-icon { margin-bottom: 12px; }
  .akz-bp .bp-toolbar .bp-btn { flex: 1 1 auto; font-size: 11px; }
  .akz-bp .bp-heading { font-size: 21px; }
  .akz-bp .bp-flow-list { grid-template-columns: minmax(0, 1fr); }
  .akz-bp .bp-flow-button { min-height: 45px; }
  .akz-bp .bp-step { grid-template-columns: 28px minmax(0, 1fr) 16px; gap: 10px; padding: 12px; }
  .akz-bp .bp-step-number { width: 28px; height: 28px; }
  .akz-bp .bp-step.bp-branch { padding: 12px; }
  .akz-bp .bp-dialog-head { padding: 17px; }
  .akz-bp .bp-dialog-body { padding: 17px; }
  .akz-bp .bp-dialog-close { width: 40px; height: 40px; }
  .akz-bp .bp-footer { margin-top: 23px; padding-top: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .akz-bp *, .akz-bp *::before, .akz-bp *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  .akz-bp .bp-group-card:hover { transform: none; }
  .akz-bp .bp-journey { scroll-snap-type: none; }
}
@media (forced-colors: active) {
  .akz-bp { border-color: CanvasText; }
  .akz-bp .bp-skyline { display: none; }
  .akz-bp .bp-btn, .akz-bp .bp-tab, .akz-bp .bp-group-card, .akz-bp .bp-tag,
  .akz-bp .bp-flow-button, .akz-bp .bp-role-button, .akz-bp .bp-step, .akz-bp .bp-journey-step { border: 1px solid ButtonText; }
  .akz-bp .bp-active, .akz-bp [aria-selected="true"], .akz-bp [aria-pressed="true"] { outline: 2px solid Highlight; outline-offset: -3px; }
}
@media print {
  .akz-bp { padding: 0; border: 0; border-radius: 0; color: #111; background: #fff; font-size: 10pt; color-scheme: light; }
  .akz-bp *, .akz-bp *::before, .akz-bp *::after { color: #111 !important; background: transparent !important; box-shadow: none !important; text-shadow: none !important; }
  .akz-bp .bp-skyline, .akz-bp .bp-toolbar, .akz-bp .bp-tabs, .akz-bp .bp-filters, .akz-bp .bp-dialog-close { display: none !important; }
  .akz-bp .bp-hero { min-height: 0; border: 0; border-bottom: 1px solid #aaa; border-radius: 0; }
  .akz-bp .bp-hero-content { max-width: none; padding: 0 0 18px; }
  .akz-bp .bp-title { max-width: none; font-size: 25pt; }
  .akz-bp .bp-subtitle { max-width: none; }
  .akz-bp .bp-hero-meta { padding: 12px 0; border-color: #aaa; }
  .akz-bp .bp-panel { margin-top: 20px; }
  .akz-bp .bp-grid, .akz-bp .bp-detail-grid, .akz-bp .bp-role-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .akz-bp .bp-card, .akz-bp .bp-detail-block, .akz-bp .bp-callout, .akz-bp .bp-step, .akz-bp .bp-row { break-inside: avoid; border-color: #aaa; }
  .akz-bp .bp-group-card { min-height: 0; padding: 15px; }
  .akz-bp .bp-journey { grid-template-columns: repeat(5, minmax(0, 1fr)); overflow: visible; }
  .akz-bp .bp-journey-step { break-inside: avoid; min-height: 0; padding: 10px; border-color: #aaa; }
  .akz-bp .bp-tag, .akz-bp .bp-count, .akz-bp .bp-step-number { border-color: #777; }
  .akz-bp .bp-registry { overflow: visible; border-color: #aaa; }
  .akz-bp .bp-registry th, .akz-bp .bp-registry td { border-color: #aaa; }
  .akz-bp .bp-split { display: block; }
  .akz-bp .bp-flow-list { display: none; }
  .akz-bp .bp-dialog { position: static; width: 100%; max-height: none; overflow: visible; border: 1px solid #aaa; margin-top: 20px; }
  .akz-bp .bp-dialog-body { overflow: visible; }
  .akz-bp .bp-footer { border-color: #aaa; }
}
`;

type Module = typeof catalog.modules[number] & { actors?:string[]; sourceRefs?:string[]; relatedRoutes?:{path:string;evidenceStatus:string}[] }
type Tab = 'overview' | 'modules' | 'workflows' | 'data' | 'people' | 'automation'
type SystemStats = { deliveries:number; riders:number; contractors:number; clients:number; products:number; users:number; tables:number; pages:number; apiRoutes:number }
const tabs: {id:Tab;label:string;icon:typeof MapIcon}[] = [
  {id:'overview',label:'Overview',icon:Compass},{id:'modules',label:'Modules',icon:Layers3},
  {id:'workflows',label:'Workflows',icon:GitBranch},{id:'data',label:'Data connections',icon:Database},
  {id:'people',label:'People & access',icon:Users},{id:'automation',label:'Automation & ideas',icon:Zap},
]
const groupIcons = [Sparkles,Truck,Boxes,Layers3,Wallet,Users,ShieldCheck]
const moduleById = new Map(catalog.modules.map(m=>[m.id,m]))
const groupById = new Map(catalog.groups.map(g=>[g.id,g]))
const evidenceLabels:Record<string,string> = {'observed-ui':'Interface observed',planned:'Coming soon','documented-only':'Documentation only','link-observed':'Linked route','conceptual-handoff':'Conceptual handoff','ui-described':'Described in UI','source-verified':'Source checked','source-reviewed':'Source reviewed'}
const labels = (id:string) => evidenceLabels[id] || 'Descriptive map'
const sourceRefs = (m:Module):string[] => [...new Set([...(m.sourceRefs||[]),...('sourceRefs' in m.automation ? m.automation.sourceRefs || [] : [])])]
const displayRole = (id:string) => catalog.roles.find(r=>r.id===id)?.name || id.replaceAll('_',' ').replaceAll('-',' ')
const nodeLabel = (flow:typeof catalog.workflows[number],id:string) => flow.nodes.find(n=>n.id===id)?.label || id

function Badge({status}:{status:string}) { return <span className="bp-tag" data-tone={status==='planned'?'amber':status==='documented-only'?'slate':'jade'}>{labels(status)}</span> }
function Head({number,title,children}:{number:string;title:string;children:ReactNode}) { return <div className="bp-section-head"><div><p className="bp-kicker">{number} / EXPLORE THE SYSTEM</p><h2 className="bp-heading">{title}</h2></div><div className="bp-muted">{children}</div></div> }
function BulletList({items}:{items:string[]}) {return <ul className="bp-bullet-list">{items.map((item,i)=><li key={`${item}-${i}`}>{item}</li>)}</ul>}
function ModuleRow({module,onOpen}:{module:Module;onOpen:(m:Module)=>void}) {return <button type="button" className="bp-row" onClick={()=>onOpen(module)}><span className="bp-row-main"><span className="bp-row-title">{module.name}</span><span className="bp-row-desc">{module.purpose}</span><span className="bp-small bp-muted">{groupById.get(module.groupId)?.name}</span></span><Badge status={module.evidenceStatus}/><ArrowUpRight size={18} aria-hidden="true"/></button>}

export function SystemBlueprintPage(_props:{stats?:SystemStats}) {
  const [tab,setTab]=useState<Tab>('overview')
  const [query,setQuery]=useState('')
  const [area,setArea]=useState('all')
  const [status,setStatus]=useState('all')
  const [selected,setSelected]=useState<Module|null>(null)
  const [flowId,setFlowId]=useState(catalog.workflows[0].id)
  const [nodeId,setNodeId]=useState(catalog.workflows[0].nodes[0].id)
  const [roleId,setRoleId]=useState(catalog.roles[0].id)
  const [registry,setRegistry]=useState<'connections'|'api'|'tables'>('connections')
  const [registryQuery,setRegistryQuery]=useState('')
  const [automationMode,setAutomationMode]=useState('all')
  const dialog=useRef<HTMLDialogElement>(null)
  const searchRef=useRef<HTMLInputElement>(null)
  const tabPrefix=useId()
  const matches=useMemo(()=>{const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);return catalog.modules.filter(m=>(area==='all'||m.groupId===area)&&(status==='all'||m.evidenceStatus===status)&&terms.every(t=>`${m.name} ${m.purpose} ${m.routes.join(' ')} ${m.features.join(' ')} ${m.inputs.join(' ')} ${m.outputs.join(' ')} ${m.humanBoundary} ${m.automation.summary} ${m.roles.map(displayRole).join(" ")} ${catalog.workflows.filter(f=>f.nodes.some(n=>n.moduleId===m.id)).map(f=>f.name+" "+f.nodes.map(n=>n.label).join(" ")).join(" ")}`.toLowerCase().includes(t)))},[query,area,status])
  const flow=catalog.workflows.find(f=>f.id===flowId) || catalog.workflows[0]
  const node=flow.nodes.find(n=>n.id===nodeId)||flow.nodes[0]
  const nodeModule=moduleById.get(node.moduleId)
  const role=catalog.roles.find(r=>r.id===roleId)||catalog.roles[0]
  const roleEvidence=source.roles.find(r=>r.id.replaceAll('_','-')===role.id.replaceAll('_','-'))
  const outgoing=flow.edges.filter(e=>e.from===node.id)
  const chooseFlow=(id:string)=>{const next=catalog.workflows.find(f=>f.id===id);if(next){setFlowId(id);setNodeId(next.nodes[0].id);setTab('workflows');setQuery('')}}
  const chooseGroup=(id:string)=>{setArea(id);setStatus('all');setQuery('');setTab('modules')}
  const clearFilters=()=>{setQuery('');setArea('all');setStatus('all')}
  const navigateTab=(id:Tab)=>{setTab(id);setQuery('');setArea('all');setStatus('all')}
  useEffect(()=>{const el=dialog.current;if(!el)return;if(selected&&!el.open)el.showModal();if(!selected&&el.open)el.close()},[selected])
  function exportMap(){const blob=new Blob([JSON.stringify({title:'Akmez System Blueprint',version:source.version,checkedOn:source.checkedOn,catalog,source,improvements},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='akmez-blueprint-2026-09-11.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

  return <section className="akz-bp" aria-label="Akmez system blueprint">
    <style>{blueprintCSS}</style>
    <header className="bp-hero">
      <BlueprintSkyline className="bp-skyline"/>
      <div className="bp-hero-content"><p className="bp-eyebrow"><span>AKMEZ / SYSTEM ATLAS</span><span className="bp-tag" data-tone="jade">Edition 2026.09</span></p><h1 className="bp-title">A clear view.<br/><span>Your whole world, connected.</span></h1><p className="bp-subtitle">From the first conversation to the final collection. Explore the people, information and decisions that move Akmez forward.</p><button type="button" className="bp-btn bp-btn-primary" onClick={()=>chooseFlow('lead-to-collection')}>Follow the main workflow <ArrowRight size={17} aria-hidden="true"/></button></div>
      <div className="bp-hero-meta">{[[catalog.modules.length,'mapped modules'],[catalog.workflows.length,'guided workflows'],[catalog.roles.length,'role profiles'],[catalog.groups.length,'business areas']].map(([count,label])=><div className="bp-stat" key={label}><span className="bp-stat-number">{count}</span><span className="bp-stat-label">{label}</span></div>)}</div>
    </header>

    <div className="bp-toolbar"><div className="bp-search"><Search size={19} aria-hidden="true"/><input ref={searchRef} className="bp-search-input" aria-label="Search modules, workflows and roles" value={query} onChange={e=>{setQuery(e.target.value);setArea('all');setStatus('all')}} placeholder="Find a module, workflow or role…"/>{query&&<button className="bp-btn" aria-label="Clear search" onClick={()=>setQuery('')}><X size={16}/></button>}</div><button type="button" className="bp-btn" onClick={exportMap}><Download size={16} aria-hidden="true"/>Export map</button></div>
    <div className="bp-tabs" role="tablist" aria-label="Blueprint views">{tabs.map((t,index)=><button key={t.id} id={`${tabPrefix}-${t.id}`} type="button" role="tab" aria-controls={`${tabPrefix}-panel`} aria-selected={tab===t.id&&!query} tabIndex={tab===t.id?0:-1} className={`bp-tab ${tab===t.id&&!query?'bp-active':''}`} onClick={()=>navigateTab(t.id)} onKeyDown={e=>{const n=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(n>=0){e.preventDefault();navigateTab(tabs[n].id);document.getElementById(`${tabPrefix}-${tabs[n].id}`)?.focus()}}}><t.icon size={17} aria-hidden="true"/>{t.label}</button>)}</div>

    <div id={`${tabPrefix}-panel`} role={query?'region':'tabpanel'} aria-label={query?'Search results':undefined} aria-labelledby={query?undefined:`${tabPrefix}-${tab}`} className="bp-panel">
    {query||tab==='modules'?<>
      <Head number="02" title={query?'Find your way through Akmez':'Every module has a part to play'}><span aria-live="polite">{matches.length} of {catalog.modules.length} mapped modules</span></Head>
      <div className="bp-filters"><label className="bp-small">Business area <select className="bp-select" aria-label="Filter modules by business area" value={area} onChange={e=>setArea(e.target.value)}><option value="all">All areas</option>{catalog.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label className="bp-small">Evidence <select className="bp-select" aria-label="Filter modules by evidence" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All evidence</option>{catalog.evidenceStatuses.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>{(area!=='all'||status!=='all'||query)&&<button className="bp-btn" onClick={clearFilters}>Reset filters</button>}</div>
      {matches.length?<div className="bp-list">{matches.map(m=><ModuleRow key={m.id} module={m} onOpen={setSelected}/>)}</div>:<div className="bp-empty"><Search size={28}/><h3>No matching modules</h3><p>Try “stock”, “supplier”, “CMS” or a shorter phrase.</p><button className="bp-btn" onClick={clearFilters}>Show every module</button></div>}
    </>:tab==='overview'?<>
      <Head number="01" title="One business. Seven connected worlds.">Choose an area to see what it does, what it receives, and where the work goes next.</Head>
      <div className="bp-journey" aria-label="Conceptual path from product to collection">{[{id:'product-master',name:'Product',detail:'What you sell'},{id:'advertising',name:'Campaign',detail:'Generate demand'},{id:'customer-inbox',name:'Conversation',detail:'Understand the need'},{id:'delivery-operations',name:'Delivery',detail:'Fulfil the order'},{id:'customer-collections',name:'Collection',detail:'Record customer money'}].map((stage,i)=><button className="bp-journey-step" key={stage.id} onClick={()=>{const m=moduleById.get(stage.id);if(m)setSelected(m)}}><span className="bp-kicker">0{i+1} {i<4&&<ArrowRight size={16} aria-hidden="true"/>}</span><strong>{stage.name}</strong><span className="bp-small bp-muted">{stage.detail}</span></button>)}</div>
      <div className="bp-grid">{catalog.groups.map((g,i)=>{const Icon=groupIcons[i];return <button className={`bp-card bp-group-card bp-area-${i+1}`} key={g.id} onClick={()=>chooseGroup(g.id)}><span className="bp-group-icon"><Icon size={24} aria-hidden="true"/></span><span className="bp-small bp-muted">0{i+1} / {g.moduleIds.length} modules</span><h3 className="bp-card-title">{g.name}</h3><p className="bp-muted">{g.purpose}</p><span className="bp-link">Explore this area <ArrowUpRight size={16} aria-hidden="true"/></span></button>})}</div>
      <div className="bp-section-head"><div><p className="bp-kicker">THE THREAD BETWEEN THEM</p><h2 className="bp-heading">Follow the work through every handoff.</h2></div><p className="bp-muted">{catalog.workflows.length} paths explain the handoffs and the decisions that need a person.</p></div>
      <div className="bp-grid">{catalog.workflows.map((f,i)=><button className="bp-card" key={f.id} onClick={()=>chooseFlow(f.id)}><span className="bp-kicker">FLOW 0{i+1}</span><h3 className="bp-card-title">{f.name}</h3><p className="bp-muted">{f.purpose}</p><span className="bp-link">{f.nodes.length} stages <ArrowRight size={16}/></span></button>)}</div>
      <div className="bp-callout"><ShieldCheck size={22} aria-hidden="true"/><div><strong>Grounded in your current system</strong><p>Production interface reviewed on 11 September 2026. Source inventory: {source.version}. Evidence labels distinguish an observed screen, inspected code and a proposed idea. Exploring this map changes no business records and starts no AI jobs.</p></div></div>
    </>:tab==='workflows'?<>
      <Head number="03" title="See how the work moves">Select a stage, then follow a labelled connection. Exception branches stay visible.</Head>
      <div className="bp-flow-list" aria-label="Choose a workflow">{catalog.workflows.map((f,i)=><button aria-pressed={f.id===flowId} className={`bp-flow-button ${f.id===flowId?'bp-active':''}`} key={f.id} onClick={()=>chooseFlow(f.id)}><span className="bp-small">0{i+1}</span>{f.name}</button>)}</div>
      <div className="bp-section-head"><div><h3 className="bp-heading">{flow.name}</h3><p className="bp-muted">{flow.purpose}</p></div><span className="bp-tag">Explanatory workflow</span></div>
      <div className="bp-split"><div className="bp-flow-steps" aria-label={`${flow.name} stages`}>{flow.nodes.map((n,i)=><button aria-pressed={n.id===node.id} className={`bp-step ${n.id===node.id?'bp-active':''} ${n.kind==='branch'?'bp-branch':''}`} key={n.id} onClick={()=>setNodeId(n.id)}><span className="bp-step-number">{n.kind==='branch'?<GitBranch size={17}/>:String(i+1).padStart(2,'0')}</span><span className="bp-step-content"><strong>{n.label}</strong><span className="bp-small bp-muted">{n.kind==='branch'?'Exception branch':moduleById.get(n.moduleId)?.name}</span></span><ChevronRight size={16}/></button>)}</div>
      <article className="bp-card"><p className="bp-kicker">SELECTED STAGE</p><h3 className="bp-card-title">{node.label}</h3><Badge status={node.evidenceStatus}/>{nodeModule&&<><p className="bp-muted">{nodeModule.purpose}</p><div className="bp-detail-grid"><div><h4>Information in</h4><BulletList items={nodeModule.inputs}/></div><div><h4>Information out</h4><BulletList items={nodeModule.outputs}/></div></div><div className="bp-callout"><Users size={18}/><div><strong>Human decision</strong><p>{nodeModule.humanBoundary}</p></div></div></>}
        <h4>Where the work can go</h4>{outgoing.length?outgoing.map(e=><button key={`${e.from}-${e.to}`} className="bp-row" onClick={()=>setNodeId(e.to)}><span className="bp-row-main"><span className="bp-small bp-accent">{e.condition}</span><span className="bp-row-title">{nodeLabel(flow,e.to)}</span><span className="bp-small bp-muted">{labels(e.evidenceStatus)}{e.note?` · ${e.note}`:''}</span></span><ArrowRight size={18}/></button>):<p className="bp-muted">This is the final outcome shown in this explanatory path.</p>}
        {nodeModule&&<button className="bp-btn" onClick={()=>setSelected(nodeModule)}>Explore this module <ArrowUpRight size={16}/></button>}
      </article></div><div className="bp-callout"><GitBranch size={22}/><div><strong>How to read this flow</strong><p>{flow.caveat}</p><p>{flow.humanBoundary}</p></div></div>
    </>:tab==='data'?<>
      <Head number="04" title="The information behind the interface">Trace a module’s inputs and outputs, or inspect the current source registry.</Head>
      <div className="bp-filters">{(['connections','api','tables'] as const).map((r)=><button key={r} aria-pressed={registry===r} className={`bp-btn ${registry===r?'bp-active':''}`} onClick={()=>{setRegistry(r);setRegistryQuery('')}}>{r==='connections'?'Business connections':r==='api'?'API registry':'Data references'}</button>)}</div>
      {registry==='connections'?<><div className="bp-callout"><Database size={22}/><div><strong>Business concepts and database tables are different things.</strong><p>These connections describe how information is used across the app. The source registry separately lists table / view references in code; it does not certify the live database schema.</p></div></div><div className="bp-grid">{catalog.groups.map((g,i)=><article key={g.id} className={`bp-card bp-area-${i+1}`}><p className="bp-kicker">{g.name}</p>{g.moduleIds.map(id=>{const m=moduleById.get(id);return m?<button className="bp-row" key={id} onClick={()=>setSelected(m)}><span className="bp-row-main"><span className="bp-row-title">{m.name}</span><span className="bp-small bp-muted">{m.inputs.slice(0,2).join(' + ')}</span><ArrowDown size={14} aria-hidden="true"/><span className="bp-small bp-accent">{m.outputs.slice(0,2).join(' · ')}</span></span><ChevronRight size={16}/></button>:null})}</article>)}</div></>:<>
      <div className="bp-metric-grid"><div className="bp-stat"><span className="bp-stat-number">{source.pageCount}</span><span className="bp-stat-label">page files</span></div><div className="bp-stat"><span className="bp-stat-number">{source.apiRouteCount}</span><span className="bp-stat-label">API route files</span></div><div className="bp-stat"><span className="bp-stat-number">{source.tableRefs.length}</span><span className="bp-stat-label">database names referenced</span></div></div>
      <p className="bp-muted bp-small">Source snapshot {source.version}, checked {source.checkedOn}. Counts describe files and code references, including public, authentication, dashboard and dynamic route pages. Database references can include historical SQL definitions. These are not live traffic, availability or database totals.</p>
      <label className="bp-search"><Search size={18}/><input className="bp-search-input" aria-label="Search source registry" value={registryQuery} onChange={e=>setRegistryQuery(e.target.value)} placeholder={registry==='api'?'Search an API route or HTTP method…':'Search a table reference…'}/></label>
      <p className="bp-small bp-muted" aria-live="polite">{registry === "api" ? source.apiRoutes.filter(r=>`${r.path} ${r.methods.join(" ")}`.toLowerCase().includes(registryQuery.toLowerCase())).length : source.tableRefs.filter(t=>t.name.toLowerCase().includes(registryQuery.toLowerCase())).length} matching references{registryQuery ? ` for “${registryQuery}”` : ""}</p><div className="bp-registry">{registry==='api'?source.apiRoutes.filter(r=>`${r.path} ${r.methods.join(' ')}`.toLowerCase().includes(registryQuery.toLowerCase())).map(r=><div className="bp-route-row" key={r.path}><code>{r.path}</code><span>{r.methods.map(method=><span key={method} className="bp-tag">{method}</span>)}</span><span className="bp-small bp-muted">{r.source}</span></div>):source.tableRefs.filter(t=>t.name.toLowerCase().includes(registryQuery.toLowerCase())).map(t=><div className="bp-route-row" key={t.name}><code>{t.name}</code><span className="bp-small bp-muted">Referenced in {t.source}</span></div>)}</div></>}
    </>:tab==='people'?<>
      <Head number="05" title="People make the system work">Understand likely involvement and the access rules found in the current code.</Head>
      <div className="bp-role-grid">{catalog.roles.map(r=><button aria-pressed={r.id===role.id} className={`bp-role-button ${r.id===role.id?'bp-active':''}`} key={r.id} onClick={()=>setRoleId(r.id)}><Users size={18}/>{r.name}</button>)}</div>
      <div className="bp-split"><article className="bp-card"><p className="bp-kicker">ROLE PROFILE</p><h3 className="bp-card-title">{role.name}</h3><p className="bp-muted">{role.involvement}</p><h4>Access found in source</h4>{roleEvidence?<><p>{roleEvidence.scope}</p><p className="bp-small bp-muted">{roleEvidence.evidence}</p><code className="bp-small">{roleEvidence.source}</code></>:<p className="bp-muted">Detailed enforcement still needs verification.</p>}<div className="bp-callout"><ShieldCheck size={22}/><div><strong>Involvement is not a permission grant</strong><p>Module associations explain likely work. Access checks differ by page and action. This review did not sign in as each role or test every authorization path.</p></div></div></article><div className="bp-list"><p className="bp-kicker">LIKELY INVOLVEMENT</p>{role.moduleIds.map(id=>moduleById.get(id)).filter((m):m is Module=>!!m).map(m=><ModuleRow key={m.id} module={m} onOpen={setSelected}/>)}</div></div>
    </>:<>
      <Head number="06" title="Useful automation. Clear human decisions.">Understand what assists the team, what needs review, and what could improve next.</Head>
      <div className="bp-callout"><Zap size={22}/><div><strong>Exploration has no AI credit cost</strong><p>This Blueprint runs locally in the page. Paid research, sending, purchasing, payouts and budget changes remain deliberate actions in their existing workspaces.</p></div></div>
      <label className="bp-small">Show <select className="bp-select" aria-label="Filter automation" value={automationMode} onChange={e=>setAutomationMode(e.target.value)}><option value="all">All assistance & derived views</option><option value="human">Human decisions</option><option value="research">Research & purchasing</option></select></label>
      <div className="bp-grid">{catalog.modules.filter(m=>automationMode==='research'?m.groupId==='procurement':automationMode==='human'?m.automation.mode!=='derived-view':true).map(m=><article key={m.id} className="bp-card"><p className="bp-kicker">{m.automation.mode.replaceAll('-',' ')}</p><h3 className="bp-card-title">{m.name}</h3><Badge status={sourceRefs(m).length ? "source-reviewed" : m.evidenceStatus}/><p className="bp-muted">{m.automation.summary}</p>{m.automation.trigger&&<p className="bp-small"><strong>Entry point:</strong> {m.automation.trigger}</p>}{m.automation.visibleStates.length>0&&<div className="bp-legend">{m.automation.visibleStates.map(s=><span className="bp-tag" key={s}>{s}</span>)}</div>}<div className="bp-detail-block"><h4>Human review</h4><p className="bp-small">{m.humanBoundary}</p></div><button className="bp-link" onClick={()=>setSelected(m)}>Read the module <ArrowUpRight size={15}/></button></article>)}</div>
      <div className="bp-section-head"><div><p className="bp-kicker">THE NEXT CHAPTER</p><h2 className="bp-heading">Ideas worth improving together</h2></div><p className="bp-muted">Review priorities. These cards do not change operational behavior.</p></div><div className="bp-grid">{improvements.map(idea=><article className="bp-card" key={idea.id}><span className="bp-tag" data-tone={idea.priority==='High'?'amber':'jade'}>{idea.priority} priority · Review idea</span><h3 className="bp-card-title">{idea.title}</h3><p className="bp-muted">{idea.problem}</p><h4>Direction</h4><p>{idea.proposal}</p><p className="bp-small bp-accent">{idea.benefit}</p><details><summary className="bp-link">Decision boundary</summary><p className="bp-small">{idea.humanBoundary}</p></details></article>)}</div>
    </>}
    </div>
    <footer className="bp-footer"><span>AKMEZ / SYSTEM ATLAS</span><span>Source {source.version} · Reviewed 11 Sep 2026</span><span>Descriptive architecture · No operational actions</span></footer>

    <dialog ref={dialog} className="bp-dialog" aria-labelledby={`${tabPrefix}-detail-title`} onCancel={()=>setSelected(null)} onClose={()=>setSelected(null)} onClick={e=>{if(e.target===e.currentTarget)setSelected(null)}}>{selected&&<>
      <div className="bp-dialog-head"><div><p className="bp-kicker">{groupById.get(selected.groupId)?.name}</p><h2 id={`${tabPrefix}-detail-title`} className="bp-heading">{selected.name}</h2></div><button type="button" className="bp-dialog-close bp-btn" aria-label="Close module details" onClick={()=>setSelected(null)} autoFocus><X size={20}/></button></div>
      <div className="bp-dialog-body"><Badge status={selected.evidenceStatus}/><p className="bp-muted">{selected.purpose}</p><div className="bp-detail-grid"><div className="bp-detail-block"><h3>Information in</h3><BulletList items={selected.inputs}/></div><div className="bp-detail-block"><h3>Information out</h3><BulletList items={selected.outputs}/></div></div><h3>Inside this module</h3><div className="bp-legend">{selected.features.map(f=><span className="bp-tag" key={f}>{f}</span>)}</div><h3>Likely people involved</h3><p>{selected.actors?.length ? selected.actors.join(" · ") : selected.roles.map(displayRole).join(" · ")}</p><p className="bp-small bp-muted">Role involvement is descriptive, not a list of granted permissions.</p><div className="bp-callout"><Users size={22}/><div><strong>Where a person decides</strong><p>{selected.humanBoundary}</p></div></div><h3>Assistance & automation</h3><p>{selected.automation.summary}</p>{sourceRefs(selected).length>0&&<details><summary className="bp-link">Source evidence</summary><ul className="bp-bullet-list">{sourceRefs(selected).map(ref=><li key={ref}><code className="bp-small">{ref}</code></li>)}</ul><p className="bp-small bp-muted">Code inspected in v949. This does not prove every path was exercised in production.</p></details>}<h3>Related workflows</h3><div className="bp-filters">{catalog.workflows.filter(f=>f.nodes.some(n=>n.moduleId===selected.id)).map(f=><button className="bp-btn" key={f.id} onClick={()=>{setSelected(null);chooseFlow(f.id)}}>{f.name}<ArrowRight size={15}/></button>)}</div><h3>Open the existing workspace</h3><div className="bp-list">{selected.routes.map(route=><a className="bp-row" href={route} target="_blank" rel="noopener noreferrer" key={route}><span className="bp-row-main"><code>{route}</code><span className="bp-small bp-muted">Opens in a new tab · existing permissions apply</span></span><ArrowUpRight size={17}/></a>)}</div>{selected.relatedRoutes&&<><h3>Related route patterns</h3><ul className="bp-bullet-list">{selected.relatedRoutes.map(r=><li key={r.path}><code>{r.path}</code><span className="bp-small bp-muted">{r.path.includes("[")?" · Requires a selected record":" · Related page"}</span></li>)}</ul></>}<p className="bp-small bp-muted">Evidence review: interface and source, 11 September 2026. {catalog.evidenceStatuses.find(s=>s.id===selected.evidenceStatus)?.meaning}</p></div>
    </>}</dialog>
  </section>
}
