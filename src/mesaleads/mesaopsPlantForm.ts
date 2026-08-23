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
    'Your team already runs the plant with daily registers, inspection sheets and shift records. '
    + 'This form helps us understand how you work today — in your own words — so MesaOrigins can match your '
    + 'logbooks, quality checks, stores, packing, dispatch and complaint handling without changing your shop-floor discipline.',
  privacyNotice:
    'MesaWorks / MesaOrigins uses your answers to review requirements, configure the platform and prepare a quotation. '
    + 'Please share only information needed for implementation.',
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

const LOGBOOK = 'Digital machine logbook';
const QA = 'Quality inspection gate (Pass / Hold / Fail)';
const INVENTORY = 'Raw material and finished goods inventory';
const DISPATCH = 'Dispatch and gate pass';
const CAPA = 'Complaints and CAPA';

/** Canonical question list for the published MesaOps plant questionnaire. */
export function desiredMesaOpsPlantQuestions(): MesaOpsPlantQuestion[] {
  return [
    q('contact_section', 'section', 'Your contact details', 10, {
      helpText: 'Who should we call or write to for discovery, quotation and go-live?',
    }),
    q('contact_name', 'short_text', 'Contact person name', 20, {
      required: true,
      placeholder: 'Full name',
      validation: { maxLength: 160 },
    }),
    q('company_name', 'short_text', 'Company / factory name', 30, {
      required: true,
      placeholder: 'Registered or trading name',
      validation: { maxLength: 200 },
    }),
    q('phone', 'phone', 'Mobile / phone number', 40, {
      required: true,
      placeholder: '+91 …',
      validation: { maxLength: 40 },
    }),
    q('email', 'email', 'Email for updates', 50, {
      required: true,
      placeholder: 'name@company.com',
      helpText: 'Quotation and follow-up messages will be sent here.',
    }),
    q('company_address', 'long_text', 'Factory / office address', 60, {
      required: true,
      placeholder: 'Street, city, state and PIN code',
      validation: { maxLength: 2000 },
    }),
    q('gst_number', 'short_text', 'GSTIN (if available)', 70, {
      helpText: 'Optional at enquiry stage.',
      placeholder: '15-character GSTIN',
      validation: { maxLength: 32 },
    }),

    q('plant_section', 'section', 'About your plant', 80, {
      helpText: 'Tell us about the site where MesaOrigins will run. Standard pricing covers one plant.',
    }),
    q('industry_process', 'single_select', 'What do you mainly manufacture?', 90, {
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
    q('industry_other', 'short_text', 'If other, please describe', 100, {
      visibilityRule: { questionKey: 'industry_process', operator: 'contains', value: 'Other' },
      validation: { maxLength: 200 },
    }),
    q('plant_count', 'number', 'How many plants / sites need MesaOrigins?', 110, {
      required: true,
      validation: { min: 1, max: 50 },
      helpText: 'One plant is included in the standard quotation; additional sites need separate pricing.',
    }),
    q('plant_names', 'long_text', 'Plant names or codes', 120, {
      placeholder: 'e.g. Pune Plant, Unit-2',
      validation: { maxLength: 2000 },
    }),
    q('shift_model', 'single_select', 'How many shifts do you run?', 130, {
      required: true,
      options: ['Day and Night (D/N)', 'Three shifts', 'Single day shift', 'Other'],
    }),
    q('primary_uoms', 'multi_select', 'Units you commonly use (kg, m, roll, …)', 140, {
      required: true,
      options: ['kg', 'm', 'nos', 'roll', 'lot', 'Other'],
    }),
    q('shop_floor_languages', 'short_text', 'Languages your operators and supervisors use', 150, {
      placeholder: 'e.g. Hindi, English, Gujarati',
      validation: { maxLength: 160 },
    }),

    q('current_ops_section', 'section', 'How you work today', 160, {
      helpText: 'We digitise what you already do on paper or Excel — tell us your current method.',
    }),
    q('current_logbook_method', 'single_select', 'How do operators record machine / line data today?', 170, {
      required: true,
      options: ['Handwritten paper register', 'Excel / Google Sheets', 'Other software', 'Mix of paper and digital', 'Not used consistently'],
    }),
    q('current_qa_method', 'single_select', 'How is quality inspection recorded today?', 180, {
      required: true,
      options: ['Paper inspection sheet', 'Excel', 'Other software', 'Verbal / informal', 'Mix'],
    }),
    q('existing_systems', 'multi_select', 'Other systems already in use', 190, {
      options: ['Excel / Google Sheets', 'Tally', 'SAP', 'Custom ERP / MES', 'WhatsApp / email only', 'None'],
    }),
    q('erp_order_feed', 'single_select', 'Will sales orders come from an ERP into MesaOrigins?', 200, {
      required: true,
      options: ['Yes — now', 'Later', 'No — MesaOrigins-only demand'],
    }),

    q('modules_section', 'section', 'What you need from MesaOrigins', 210, {
      helpText: 'Describe your requirement in your own words, then tick the areas you want in the first go-live.',
    }),
    q('project_scope', 'long_text', 'Describe your requirement (scope)', 215, {
      required: true,
      helpText: 'Write freely in English or your local language — what problems you want solved, which departments are involved, and what must be live on day one.',
      validation: { maxLength: 5000 },
    }),
    q('modules_required', 'multi_select', 'Which areas should be included at go-live?', 220, {
      required: true,
      options: [
        LOGBOOK,
        'QR code machine login',
        'Sales enquiry to confirmed order',
        'Production planning and scheduling',
        'Formula / recipe (BOM) management',
        QA,
        INVENTORY,
        DISPATCH,
        CAPA,
        'Batch passport / lot traceability',
        'Preventive maintenance',
        'Role-based dashboards',
      ],
    }),
    q('ai_chatbot_interest', 'yes_no', 'Interested in the optional AI chatbot add-on later?', 230, {
      helpText: 'Optional in the commercial proposal; extra usage charges may apply.',
    }),

    q('logbook_section', 'section', 'Machine logbook — formats and details', 240, {
      helpText: 'Share how your paper or Excel logbook looks today so we can match field names, columns and sign-off.',
    }),
    q('product_families', 'long_text', 'Product families / items you run on each line', 250, {
      required: true,
      placeholder: 'e.g. 20 mm soft coil, 110 mm pipe, specific customer SKUs',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_formats', 'long_text', 'Describe each logbook format you use (pipe, coil, profile, other)', 260, {
      required: true,
      helpText: 'For each format: product name, whether it is pipe / coil / sheet / other, and how many different register layouts you have.',
      validation: { maxLength: 5000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_document_ref', 'short_text', 'Logbook document number and revision (if any)', 270, {
      placeholder: 'e.g. QR/MFG/013 Rev 2',
      validation: { maxLength: 160 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_shift_fields', 'long_text', 'What do operators write each shift or each hour?', 280, {
      required: true,
      helpText: 'List every column or row: date, shift, operator name, machine speed, temperatures, pressures, meter reading, roll number, scrap, remarks, etc.',
      validation: { maxLength: 5000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_temperature_zones', 'long_text', 'Temperature zones — names, targets and limits', 290, {
      helpText: 'How many die / barrel / other zones you record, zone labels (Z1, D1, …), and typical target / min / max if fixed on the sheet.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('die_zone_count', 'number', 'Typical number of die temperature zones', 300, {
      validation: { min: 0, max: 40 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('barrel_zone_count', 'number', 'Typical number of barrel temperature zones', 310, {
      validation: { min: 0, max: 40 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('hourly_readings', 'yes_no', 'Do operators enter readings every hour (not only end of shift)?', 320, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_output_recording', 'long_text', 'How is finished output recorded on the logbook?', 330, {
      required: true,
      helpText: 'Rolls, meters, weight, pieces, bundle size, winder operator, lot / batch number — whatever your sheet uses.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('scrap_categories', 'multi_select', 'Scrap / waste categories you track', 340, {
      options: ['Process waste', 'Lumps', 'Rejection', 'Trim', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('logbook_rejection_detail', 'long_text', 'Rejection reasons and how scrap is noted', 350, {
      placeholder: 'e.g. ovality, burn, colour mismatch — and whether weight or length is recorded',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('signoff_rules', 'single_select', 'Who signs the logbook when the shift or job is complete?', 360, {
      options: ['Operator only', 'Operator + supervisor', 'Supervisor only', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('sample_logbook_file', 'file', 'Upload a sample paper logbook or Excel sheet', 370, {
      helpText: 'JPG, PNG or PDF. Maximum 5 MB. A photo or scan of your actual register helps us match layout and wording.',
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: LOGBOOK },
    }),
    q('machine_count', 'number', 'Approximate number of production machines / lines', 380, {
      required: true,
      validation: { min: 1, max: 500 },
    }),

    q('quality_section', 'section', 'Quality inspection', 390, {
      helpText: 'Tell us how QA checks material before it moves to stores or dispatch.',
    }),
    q('inspection_unit', 'single_select', 'What unit do you inspect?', 400, {
      required: true,
      options: ['Roll', 'Lot / batch', 'Piece', 'Meter', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: QA },
    }),
    q('qa_extra_checks', 'long_text', 'All checks on your inspection sheet (beyond finish, colour, tearing, dimensions)', 410, {
      placeholder: 'List every check and acceptable limit if written on the sheet',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: QA },
    }),
    q('hold_disposition', 'multi_select', 'When material is on hold, what can happen next?', 420, {
      options: ['Rework', 'Scrap', 'Downgrade', 'Customer waiver', 'Other'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: QA },
    }),

    q('capa_section', 'section', 'Customer complaints and CAPA', 430, {
      helpText: 'How you record complaints after dispatch and how corrective / preventive action is closed.',
    }),
    q('capa_current_process', 'long_text', 'How do you handle customer complaints today?', 440, {
      required: true,
      helpText: 'Paper register, Excel, email, WhatsApp — who receives the complaint and what information is captured first.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('capa_complaint_types', 'long_text', 'Types of complaints you see (quality, quantity, packing, delivery, …)', 450, {
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('capa_severity_sla', 'long_text', 'Severity levels and response / closure timelines', 460, {
      placeholder: 'e.g. Critical — respond in 24 h, close in 7 days; Minor — close in 30 days',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('capa_investigation_steps', 'long_text', 'Root-cause investigation steps you follow', 470, {
      helpText: '5-Why, fishbone, batch trace back to machine / shift / RM lot — whatever your team already uses.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('capa_corrective_format', 'long_text', 'Corrective and preventive action (CA / PA) — what must be recorded?', 480, {
      helpText: 'Responsible person, due date, verification sign-off, link to batch or customer order, etc.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('capa_approvals', 'long_text', 'Who opens, reviews and closes a CAPA record?', 490, {
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),
    q('sample_capa_file', 'file', 'Upload a sample complaint / CAPA format (if available)', 500, {
      helpText: 'JPG, PNG or PDF. Maximum 5 MB.',
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: CAPA },
    }),

    q('stores_dispatch_section', 'section', 'Stores, packing and dispatch', 510, {
      helpText: 'From RM inward to finished goods packing and truck out — describe the registers and checks you use.',
    }),
    q('lot_tracking', 'yes_no', 'Is lot / batch number mandatory on every RM receive?', 520, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: INVENTORY },
    }),
    q('packing_method_detail', 'long_text', 'How is finished goods packed before dispatch?', 530, {
      required: true,
      helpText: 'Roll wrapping, bundling, cartons, pallets, weight per bundle, label on each pack — describe your usual method.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('packing_label_fields', 'long_text', 'What appears on the packing label or sticker?', 540, {
      placeholder: 'Product name, lot, weight, length, customer name, PO number, date, operator, …',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('packing_weight_check', 'yes_no', 'Is weight checked at packing or dispatch?', 550, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('dispatch_workflow', 'long_text', 'Steps from QA pass to goods leaving the gate', 560, {
      required: true,
      helpText: 'e.g. ready list → packing → weighment → invoice / LR → gate pass → security out — name each step and who signs.',
      validation: { maxLength: 3000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('partial_dispatch', 'yes_no', 'Do you dispatch part of an order and balance later?', 570, {
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('partial_dispatch_rules', 'long_text', 'If partial dispatch — how is balance quantity tracked?', 580, {
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('gate_pass_fields', 'long_text', 'Gate pass / delivery challan / packing list — fields you need', 590, {
      required: true,
      placeholder: 'Vehicle number, driver name, transporter, invoice ref, e-way bill, seal number, …',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('dispatch_documents', 'long_text', 'Documents that must move with the shipment', 600, {
      helpText: 'Invoice copy, test certificate, COA, customer-specific formats, photos, etc.',
      validation: { maxLength: 2000 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),
    q('statutory_docs_source', 'single_select', 'Where will invoice / e-way bill come from?', 610, {
      options: ['MesaERP later', 'External system', 'Manual attach only', 'Not required at go-live'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: DISPATCH },
    }),

    q('maintenance_section', 'section', 'Maintenance', 620),
    q('machine_families', 'short_text', 'Machine names / coding scheme on your floor', 630, {
      placeholder: 'e.g. EXT-01, EXT-02 — or how you identify each line',
      validation: { maxLength: 300 },
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Preventive maintenance' },
    }),
    q('pm_frequencies', 'multi_select', 'Preventive maintenance schedule you follow', 640, {
      options: ['Weekly', 'Monthly', 'Quarterly', 'Semiannually', 'Running hours', 'Breakdown only'],
      visibilityRule: { questionKey: 'modules_required', operator: 'contains', value: 'Preventive maintenance' },
    }),

    q('master_data_section', 'section', 'Master data readiness', 650, {
      helpText: 'After this form we will share CSV / Excel templates for customers, machines, recipes, materials and employees.',
    }),
    q('can_provide_csv', 'yes_no', 'Can you provide master data in Excel or CSV before go-live?', 660, {
      required: true,
    }),
    q('approx_customers', 'number', 'Approximate active customers', 670, { validation: { min: 0 } }),
    q('approx_formulations', 'number', 'Approximate active recipes / formulations', 680, { validation: { min: 0 } }),
    q('approx_rm_items', 'number', 'Approximate raw material items', 690, { validation: { min: 0 } }),
    q('approx_employees', 'number', 'Plant users who need login', 700, {
      required: true,
      validation: { min: 1, max: 500 },
      helpText: 'Operators, QA, stores, planners, dispatch, maintenance, management. Standard plan includes 12 users.',
    }),

    q('golive_section', 'section', 'Devices and go-live', 710),
    q('devices', 'multi_select', 'Devices the team will use on the floor and in office', 720, {
      required: true,
      options: ['Desktop (office)', 'Tablet', 'Phone', 'Shared shop-floor kiosk'],
    }),
    q('offline_needed', 'yes_no', 'Must the system work when network is weak or offline?', 730, {
      required: true,
    }),
    q('target_golive', 'date', 'Target go-live date', 740, {
      helpText: 'Typical implementation is about 3 weeks from kickoff when master data is ready.',
    }),
    q('parallel_run', 'yes_no', 'Will you keep paper / old system running in parallel for some time?', 750),
    q('success_criteria', 'long_text', 'What should be working in the first successful week?', 760, {
      placeholder: 'e.g. all shifts on digital logbooks, one full dispatch cycle, QR login on every line',
      validation: { maxLength: 2000 },
    }),

    q('commercial_section', 'section', 'Commercial preference', 770, {
      helpText: 'Reference pricing (single plant): Implementation ₹29,999 one-time; Platform ₹12,999/mo or ₹1,29,999/yr.',
    }),
    q('platform_plan', 'single_select', 'Preferred platform billing', 780, {
      required: true,
      options: ['Monthly (₹12,999 / mo)', 'Annual (₹1,29,999 / yr — saves ~₹26,000)', 'Undecided — need discussion'],
    }),
    q('commercial_notes', 'long_text', 'Commercial notes or constraints', 790, {
      placeholder: 'PO process, advance terms, additional plants, user volume, …',
      validation: { maxLength: 2000 },
    }),

    q('gaps_section', 'section', 'Anything we missed', 800, {
      helpText: 'Requirements that must be true for you to go live but were not covered above.',
    }),
    q('must_have_gaps', 'long_text', 'Must-have gaps or custom needs', 810, {
      placeholder: 'Describe process steps, reports or fields MesaOrigins must support',
      validation: { maxLength: 5000 },
    }),
    q('additional_notes', 'long_text', 'Anything else we should know?', 820, {
      placeholder: 'Timeline, training language, compliance, special customer formats, …',
      validation: { maxLength: 5000 },
    }),
  ];
}
