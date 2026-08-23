/**
 * MesaOps plant-digitisation requirements questionnaire.
 * Shared by MesaLeads FormBuilder and the MesaWorks provision script.
 * Aligned to MO-QT-2026-MP01 and docs/specs/mesaops-client-requirements-questionnaire.md.
 */

export type MesaOpsPlantQuestion = {
  key: string;
  type:
    | 'section'
    | 'short_text'
    | 'long_text'
    | 'email'
    | 'phone'
    | 'number'
    | 'date'
    | 'single_select'
    | 'multi_select'
    | 'yes_no'
    | 'file';
  label: string;
  helpText: string;
  placeholder: string;
  required: boolean;
  options: string[];
  validation: Record<string, unknown>;
  visibilityRule?: {
    questionKey: string;
    operator: 'equals' | 'not_equals' | 'contains';
    value: unknown;
  };
  sortOrder: number;
};

export const MESAOPS_PLANT_FORM_FAMILY = 'mesaops-plant-digitisation-requirements';

export const MESAOPS_PLANT_FORM_META = {
  name: 'MesaOps Plant Digitisation — Requirements Questionnaire',
  description:
    'Your plant already runs on strong discipline — logbooks, inspection formats and shift registers filled every day. '
    + 'This form helps MesaOrigins understand how you work today so we can configure digital machine logbooks, '
    + 'traceability and the connected plant flow (enquiry → plan → logbook → QA → stores → dispatch) without changing how your shop floor operates.',
  privacyNotice:
    'MesaWorks / MesaOrigins will use this information to review your plant requirements, prepare a technical configuration '
    + 'and issue a quotation. Do not upload unrelated personal or confidential information beyond what is needed for implementation.',
} as const;

const q = (
  key: string,
  type: MesaOpsPlantQuestion['type'],
  label: string,
  sortOrder: number,
  patch: Partial<Omit<MesaOpsPlantQuestion, 'key' | 'type' | 'label' | 'sortOrder'>> = {},
): MesaOpsPlantQuestion => ({
  key,
  type,
  label,
  sortOrder,
  required: false,
  helpText: '',
  placeholder: '',
  options: [],
  validation: {},
  ...patch,
});

/** Canonical question list for the published MesaOps plant questionnaire. */
export function desiredMesaOpsPlantQuestions(): MesaOpsPlantQuestion[] {
  return [
    q('contact_section', 'section', 'Contact and company', 10, {
      helpText: 'Who should we coordinate with for discovery, quotation and go-live?',
    }),
    q('contact_name', 'short_text', 'Contact person name', 20, {
      required: true,
      placeholder: 'Full name',
      validation: { maxLength: 160 },
    }),
    q('company_name', 'short_text', 'Company / trading name', 30, {
      required: true,
      placeholder: 'Registered or trading name',
      validation: { maxLength: 200 },
    }),
    q('phone', 'phone', 'Contact number', 40, {
      required: true,
      placeholder: '+91 …',
      validation: { maxLength: 40 },
    }),
    q('email', 'email', 'Business email', 50, {
      required: true,
      placeholder: 'name@company.com',
      helpText: 'Quotation updates will be sent here.',
    }),
    q('company_address', 'long_text', 'Company / plant address', 60, {
      required: true,
      placeholder: 'Street, city, state and PIN code',
      validation: { maxLength: 2000 },
    }),
    q('gst_number', 'short_text', 'GSTIN', 70, {
      helpText: 'Optional at enquiry stage.',
      placeholder: '15-character GSTIN',
      validation: { maxLength: 32 },
    }),

    q('plant_section', 'section', 'Plant profile', 80, {
      helpText: 'Tell us about the site MesaOps will run on (single-plant pricing covers one site).',
    }),
    q('industry_process', 'single_select', 'Primary process / industry', 90, {
      required: true,
      options: [
        'PVC pipe / profile',
        'Soft / hard coil',
        'Film / sheet',
        'Rubber / elastomer',
        'Other extrusion',
        'Other manufacturing',
      ],
    }),
    q('industry_other', 'short_text', 'If other, describe the process', 100, {
      visibilityRule: { questionKey: 'industry_process', operator: 'contains', value: 'Other' },
      validation: { maxLength: 200 },
    }),
    q('plant_count', 'number', 'Number of plants / sites for MesaOps', 110, {
      required: true,
      validation: { min: 1, max: 50 },
      helpText: 'Standard quotation covers a single plant; additional plants need group pricing.',
    }),
    q('plant_names', 'long_text', 'Plant codes and names', 120, {
      placeholder: 'e.g. PRIMARY — Pune Plant',
      validation: { maxLength: 2000 },
    }),
    q('shift_model', 'single_select', 'Shift model', 130, {
      required: true,
      options: ['Day and Night (D/N)', 'Three shifts', 'Single day shift', 'Other'],
    }),
    q('primary_uoms', 'multi_select', 'Primary units of measure', 140, {
      required: true,
      options: ['kg', 'm', 'nos', 'roll', 'lot', 'Other'],
    }),
    q('shop_floor_languages', 'short_text', 'Languages needed on the shop floor', 150, {
      placeholder: 'e.g. Hindi, English, Gujarati',
      validation: { maxLength: 160 },
    }),

    q('current_ops_section', 'section', 'How you work today', 160, {
      helpText: 'MesaOrigins digitises your existing discipline — we need to know what is handwritten or spreadsheet-based today.',
    }),
    q('current_logbook_method', 'single_select', 'How are machine logbooks kept today?', 170, {
      required: true,
      options: ['Handwritten paper register', 'Excel / Google Sheets', 'Other software', 'Mix of paper and digital', 'Not used consistently'],
    }),
    q('current_qa_method', 'single_select', 'How is quality inspection recorded today?', 180, {
      required: true,
      options: ['Paper inspection sheet', 'Excel', 'Other software', 'Verbal / informal', 'Mix'],
    }),
    q('existing_systems', 'multi_select', 'Existing systems in use', 190, {
      options: ['Excel / Google Sheets', 'Tally', 'SAP', 'Custom ERP / MES', 'WhatsApp / email only', 'None'],
    }),
    q('erp_order_feed', 'single_select', 'Will an ERP feed sales orders into MesaOps?', 200, {
      required: true,
      options: ['Yes — now', 'Later', 'No — MesaOps-only demand'],
    }),

    q('modules_section', 'section', 'Module scope', 210, {
      helpText: 'Select everything you want in the first go-live. Pricing in MO-QT covers the connected plant platform for one site.',
    }),
    q('modules_required', 'multi_select', 'Which MesaOps capabilities do you need at go-live?', 220, {
      required: true,
      options: [
        'Digital machine logbook',
        'QR code machine login',
        'Sales enquiry to confirmed order',
        'Production planning and scheduling',
        'Formula / recipe (BOM) management',
        'Quality inspection gate (Pass / Hold / Fail)',
        'Raw material and finished goods inventory',
        'Dispatch and gate pass',
        'Complaints and CAPA',
        'Batch passport / lot traceability',
        'Preventive maintenance',
        'Role-based dashboards',
      ],
    }),
    q('ai_chatbot_interest', 'yes_no', 'Interested in the optional AI chatbot add-on later?', 230, {
      helpText: 'Listed as optional / future in the commercial proposal; extra usage charges may apply.',
    }),

    q('logbook_section', 'section', 'Logbook and production', 240, {
      helpText: 'Shown when digital machine logbook is in scope.',
    }),
    q('product_families', 'long_text', 'Product families run on your lines', 250, {
      required: true,
      placeholder: 'e.g. soft coil, hard pipe, specific SKUs',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('logbook_layout', 'multi_select', 'Logbook layouts needed', 260, {
      required: true,
      options: ['Pipe', 'Coil', 'Other / custom'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('die_zone_count', 'number', 'Typical number of die temperature zones', 270, {
      validation: { min: 0, max: 40 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('barrel_zone_count', 'number', 'Typical number of barrel temperature zones', 280, {
      validation: { min: 0, max: 40 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('hourly_readings', 'yes_no', 'Do operators enter hourly readings today?', 290, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('scrap_categories', 'multi_select', 'Scrap / waste categories you track', 300, {
      options: ['Process waste', 'Lumps', 'Rejection', 'Trim', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('signoff_rules', 'single_select', 'Logbook sign-off rule', 310, {
      options: ['Operator only', 'Operator + supervisor', 'Supervisor only', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('sample_logbook_file', 'file', 'Sample paper logbook or inspection sheet', 320, {
      helpText: 'JPG, PNG or PDF. Maximum 5 MB. Helps us match your existing form (doc / rev).',
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Digital machine logbook' },
    }),
    q('machine_count', 'number', 'Approximate number of production machines', 330, {
      required: true,
      validation: { min: 1, max: 500 },
    }),

    q('quality_section', 'section', 'Quality', 340, {
      helpText: 'Shown when quality inspection gate is in scope.',
    }),
    q('inspection_unit', 'single_select', 'What is inspected?', 350, {
      required: true,
      options: ['Roll', 'Lot / batch', 'Piece', 'Meter', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Quality inspection gate (Pass / Hold / Fail)' },
    }),
    q('qa_extra_checks', 'long_text', 'Checks beyond finish, colour, tearing and dimensions', 360, {
      placeholder: 'List any mandatory checks your QA sheet already uses',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Quality inspection gate (Pass / Hold / Fail)' },
    }),
    q('hold_disposition', 'multi_select', 'Hold dispositions you use', 370, {
      options: ['Rework', 'Scrap', 'Downgrade', 'Customer waiver', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Quality inspection gate (Pass / Hold / Fail)' },
    }),

    q('stores_dispatch_section', 'section', 'Stores and dispatch', 380),
    q('lot_tracking', 'yes_no', 'Is lot / batch number mandatory on every RM receive?', 390, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Raw material and finished goods inventory' },
    }),
    q('partial_dispatch', 'yes_no', 'Do you need partial dispatch against an order?', 400, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Dispatch and gate pass' },
    }),
    q('gate_pass_fields', 'long_text', 'Gate pass / packing list fields you require', 410, {
      placeholder: 'e.g. vehicle number, driver, transporter, invoice ref, e-way bill',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Dispatch and gate pass' },
    }),
    q('statutory_docs_source', 'single_select', 'Invoice / e-way bill source', 420, {
      options: ['MesaERP later', 'External system', 'Manual attach only', 'Not required at go-live'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Dispatch and gate pass' },
    }),

    q('maintenance_section', 'section', 'Maintenance', 430),
    q('machine_families', 'short_text', 'Machine families / coding scheme', 440, {
      placeholder: 'e.g. PVC extruders EXT-01…',
      validation: { maxLength: 300 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Preventive maintenance' },
    }),
    q('pm_frequencies', 'multi_select', 'Preventive maintenance frequencies in use', 450, {
      options: ['Weekly', 'Monthly', 'Quarterly', 'Semiannually', 'Running hours', 'Breakdown only'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Preventive maintenance' },
    }),

    q('master_data_section', 'section', 'Master data readiness', 460, {
      helpText: 'After this questionnaire, we will ask for CSV / Excel packs (customers, machines, formulations, RM, employees).',
    }),
    q('can_provide_csv', 'yes_no', 'Can you provide master data as CSV or Excel before go-live?', 470, {
      required: true,
    }),
    q('approx_customers', 'number', 'Approximate active customers', 480, { validation: { min: 0 } }),
    q('approx_formulations', 'number', 'Approximate active formulations / recipes', 490, { validation: { min: 0 } }),
    q('approx_rm_items', 'number', 'Approximate raw material items', 500, { validation: { min: 0 } }),
    q('approx_employees', 'number', 'Plant users who need login (operators, QA, store, planners, …)', 510, {
      required: true,
      validation: { min: 1, max: 500 },
      helpText: 'Standard platform plan includes 12 plant users; higher volumes need group pricing.',
    }),

    q('golive_section', 'section', 'Devices and go-live', 520),
    q('devices', 'multi_select', 'Devices the team will use', 530, {
      required: true,
      options: ['Desktop (office)', 'Tablet', 'Phone', 'Shared shop-floor kiosk'],
    }),
    q('offline_needed', 'yes_no', 'Must MesaOps work offline or on poor shop-floor network?', 540, {
      required: true,
    }),
    q('target_golive', 'date', 'Target go-live date', 550, {
      helpText: 'Typical implementation is about 3 weeks from kickoff when master data is ready.',
    }),
    q('parallel_run', 'yes_no', 'Will you run paper / old system in parallel for a period?', 560),
    q('success_criteria', 'long_text', 'What does a successful first week look like?', 570, {
      placeholder: 'e.g. all shifts on digital logbooks, one full dispatch cycle, QR login on every line',
      validation: { maxLength: 2000 },
    }),

    q('commercial_section', 'section', 'Commercial preference', 580, {
      helpText: 'Reference pricing from MesaOrigins quotation (single plant): Implementation ₹29,999 one-time; Platform ₹12,999/mo or ₹1,29,999/yr.',
    }),
    q('platform_plan', 'single_select', 'Preferred platform billing', 590, {
      required: true,
      options: ['Monthly (₹12,999 / mo)', 'Annual (₹1,29,999 / yr — saves ~₹26,000)', 'Undecided — need discussion'],
    }),
    q('commercial_notes', 'long_text', 'Commercial notes or constraints', 600, {
      placeholder: 'PO process, advance terms, additional plants, user volume, …',
      validation: { maxLength: 2000 },
    }),

    q('gaps_section', 'section', 'Enhancements and gaps', 610, {
      helpText: 'Anything not covered above that must be true for you to go live.',
    }),
    q('must_have_gaps', 'long_text', 'Must-have gaps or custom needs', 620, {
      placeholder: 'Describe process steps, reports or fields MesaOps must support that you did not see above',
      validation: { maxLength: 5000 },
    }),
    q('additional_notes', 'long_text', 'Anything else we should know?', 630, {
      placeholder: 'Timeline pressure, training language, compliance, …',
      validation: { maxLength: 5000 },
    }),
  ];
}
