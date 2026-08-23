import type { LeadQuestion, LeadStage, QuestionType } from './types';
import {
  desiredMesaOpsPlantQuestions,
  MESAOPS_PLANT_FORM_FAMILY,
  MESAOPS_PLANT_FORM_META,
} from './mesaopsPlantForm';

export { MESAOPS_PLANT_FORM_FAMILY, MESAOPS_PLANT_FORM_META };

export const LEAD_STAGES: Array<{ id: LeadStage; label: string; short: string }> = [
  { id: 'new', label: 'New', short: 'New' },
  { id: 'discovery', label: 'Discovery', short: 'Discovery' },
  { id: 'questionnaire_sent', label: 'Questionnaire sent', short: 'Form sent' },
  { id: 'requirements_received', label: 'Requirements received', short: 'Received' },
  { id: 'technical_review', label: 'Technical review', short: 'Review' },
  { id: 'mold_sourcing', label: 'Mold sourcing', short: 'Mold' },
  { id: 'quotation', label: 'Quotation', short: 'Quote' },
  { id: 'follow_up', label: 'Follow-up', short: 'Follow-up' },
  { id: 'won', label: 'Won', short: 'Won' },
  { id: 'lost', label: 'Lost', short: 'Lost' },
];

export const QUESTION_TYPES: Array<{ id: QuestionType; label: string }> = [
  { id: 'short_text', label: 'Short text' },
  { id: 'long_text', label: 'Long text' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'single_select', label: 'Single choice' },
  { id: 'multi_select', label: 'Multiple choice' },
  { id: 'yes_no', label: 'Yes / No' },
  { id: 'file', label: 'File / photo' },
  { id: 'section', label: 'Section heading' },
];

const q = (
  key: string,
  type: LeadQuestion['type'],
  label: string,
  sortOrder: number,
  patch: Partial<LeadQuestion> = {},
): LeadQuestion => ({
  key,
  type,
  label,
  sortOrder,
  required: false,
  helpText: '',
  placeholder: '',
  options: [],
  ...patch,
});

export const IMM_FORM_QUESTIONS: LeadQuestion[] = [
  q('contact_section', 'section', 'Contact and business', 10, { helpText: 'Tell us who we should contact about this requirement.' }),
  q('contact_name', 'short_text', 'Contact name', 20, { required: true, placeholder: 'Full name' }),
  q('company_name', 'short_text', 'Company name', 30, { required: true, placeholder: 'Registered or trading name' }),
  q('phone', 'phone', 'Contact number', 40, { required: true, placeholder: '+91 98765 43210' }),
  q('email', 'email', 'Business email', 50, { required: true, placeholder: 'name@company.com' }),
  q('company_address', 'long_text', 'Company address', 60, { placeholder: 'Street, city, state and PIN code' }),
  q('gst_number', 'short_text', 'GSTIN', 70, { helpText: 'Optional during initial qualification.' }),

  q('part_section', 'section', 'Part requirement', 80, { helpText: 'Share the part, material and production requirement.' }),
  q('product', 'short_text', 'Product or item name', 90, { required: true, placeholder: 'e.g. Electrical enclosure cap' }),
  q('product_details', 'long_text', 'Product details', 100, { required: true, placeholder: 'Function, application and critical requirements' }),
  q('material', 'short_text', 'Polymer / material and grade', 110, { required: true, placeholder: 'e.g. PP, ABS, PC-ABS, or customer-supplied grade' }),
  q('part_weight', 'number', 'Part or shot weight (grams)', 120, { required: true, validation: { min: 0 } }),
  q('quantity', 'number', 'Required quantity per month', 130, { required: true, validation: { min: 1 } }),
  q('required_by', 'date', 'Required production start date', 140),
  q('part_files', 'file', 'Drawing, CAD, sample photo or specification', 150, {
    helpText: 'JPG, PNG or PDF. Maximum 5 MB per file.',
  }),

  q('solution_section', 'section', 'Machine and mold scope', 160, { helpText: 'This determines the technical and supplier review path.' }),
  q('scope', 'single_select', 'What do you need?', 170, {
    required: true,
    options: ['machine_only', 'machine_mold', 'mold_only'],
  }),
  q('existing_mold', 'yes_no', 'Do you already have a mold?', 180, {
    visibilityRule: { questionKey: 'scope', operator: 'contains', value: 'mold' },
  }),
  q('mold_details', 'long_text', 'Mold details', 190, {
    helpText: 'Include mold dimensions, weight, number of cavities, runner type and drawing reference when known.',
    visibilityRule: { questionKey: 'scope', operator: 'contains', value: 'mold' },
  }),
  q('target_output', 'number', 'Target production output per hour', 200, { validation: { min: 0 } }),

  q('facility_section', 'section', 'Factory readiness', 210, { helpText: 'Help us plan installation and utilities.' }),
  q('factory_location', 'short_text', 'Factory location', 220, { required: true }),
  q('floor_area', 'number', 'Available floor area (sq ft)', 230, { validation: { min: 0 } }),
  q('connected_power', 'number', 'Total connected power available (kW)', 240, { validation: { min: 0 } }),
  q('three_phase_power', 'yes_no', 'Is three-phase power available?', 250, { required: true }),
  q('funding', 'single_select', 'Purchase funding', 260, { options: ['own_funds', 'bank_finance', 'undecided'] }),

  q('auxiliary_section', 'section', 'Auxiliaries and notes', 270, { helpText: 'Select any supporting equipment required with the solution.' }),
  q('auxiliaries', 'multi_select', 'Required auxiliaries', 280, {
    options: ['Grinder / granulator', 'Hopper dryer', 'Material loader', 'Mold temperature controller', 'Chiller', 'Conveyor / robot'],
  }),
  q('additional_notes', 'long_text', 'Anything else we should know?', 290, { placeholder: 'Budget, timeline, quality checks, installation constraints or other expectations' }),
];

/** MesaOps plant-digitisation questionnaire (FormBuilder + MesaWorks provision). */
export const MESAOPS_PLANT_FORM_QUESTIONS: LeadQuestion[] = desiredMesaOpsPlantQuestions().map((question) => ({
  key: question.key,
  type: question.type,
  label: question.label,
  helpText: question.helpText,
  placeholder: question.placeholder,
  required: question.required,
  options: [...question.options],
  validation: { ...question.validation },
  ...(question.visibilityRule ? { visibilityRule: { ...question.visibilityRule } } : {}),
  sortOrder: question.sortOrder,
}));

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

