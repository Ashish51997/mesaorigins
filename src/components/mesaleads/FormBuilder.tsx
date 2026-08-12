import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clipboard,
  Copy,
  Eye,
  FileUp,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { createLeadFormLink, publishLeadForm, saveLeadForm } from './api';
import { humanize, IMM_FORM_QUESTIONS, QUESTION_TYPES } from './constants';
import type { LeadForm, LeadFormLink, LeadQuestion, QuestionType, VisibilityRule } from './types';

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';

function copyQuestions(questions: LeadQuestion[]): LeadQuestion[] {
  return questions.map((question) => ({
    ...question,
    options: [...question.options],
    validation: question.validation ? { ...question.validation } : undefined,
    visibilityRule: question.visibilityRule ? { ...question.visibilityRule } : null,
  }));
}

function newQuestion(type: QuestionType, sortOrder: number): LeadQuestion {
  const id = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    key: id,
    type,
    label: type === 'section' ? 'New section' : 'New question',
    helpText: '',
    placeholder: '',
    required: false,
    options: ['single_select', 'multi_select'].includes(type) ? ['Option 1', 'Option 2'] : [],
    validation: {},
    visibilityRule: null,
    sortOrder,
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not save the questionnaire.';
}

function PreviewField({ question }: { question: LeadQuestion }) {
  if (question.type === 'section') {
    return (
      <div className="border-b border-slate-200 pb-2 pt-2 first:pt-0">
        <p className="text-sm font-bold text-slate-900">{question.label || 'Untitled section'}</p>
        {question.helpText && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{question.helpText}</p>}
      </div>
    );
  }
  const label = <p className="text-xs font-bold text-slate-700">{question.label || 'Untitled question'} {question.required && <span className="text-rose-600">*</span>}</p>;
  if (question.type === 'long_text') return <div>{label}<div className="mt-1.5 h-16 rounded-lg border border-slate-200 bg-slate-50" /></div>;
  if (question.type === 'single_select' || question.type === 'multi_select' || question.type === 'yes_no') {
    const options = question.type === 'yes_no' ? ['Yes', 'No'] : question.options;
    return <div>{label}<div className="mt-1.5 flex flex-wrap gap-1.5">{options.map((option) => <span key={option} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">{humanize(option)}</span>)}</div></div>;
  }
  if (question.type === 'file') return <div>{label}<div className="mt-1.5 flex h-14 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-500"><FileUp className="h-4 w-4" /> Choose attachment</div></div>;
  return <div>{label}<div className="mt-1.5 h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] text-slate-400">{question.placeholder || QUESTION_TYPES.find((item) => item.id === question.type)?.label}</div></div>;
}

export default function FormBuilder({
  form,
  onClose,
  onSaved,
}: {
  form?: LeadForm | null;
  onClose: () => void;
  onSaved: (form: LeadForm) => void;
}) {
  const [savedForm, setSavedForm] = useState<LeadForm | null>(form ?? null);
  const [name, setName] = useState(form?.name ?? 'IMM Requirement Questionnaire');
  const [description, setDescription] = useState(form?.description ?? 'Share your part, machine, mold and factory requirements so our engineering team can prepare the right solution.');
  const [privacyNotice, setPrivacyNotice] = useState(form?.privacyNotice ?? 'Your information will be used by this organization to review and respond to your enquiry.');
  const [questions, setQuestions] = useState<LeadQuestion[]>(() => copyQuestions(form?.questions?.length ? form.questions : IMM_FORM_QUESTIONS));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState<LeadFormLink | null>(() => form?.links?.find((item) => item.kind === 'generic' && (item.token || item.publicPath)) ?? null);

  const ordered = useMemo(() => [...questions].sort((a, b) => a.sortOrder - b.sortOrder), [questions]);
  const locked = savedForm?.status === 'published' || savedForm?.status === 'archived';
  const update = (key: string, patch: Partial<LeadQuestion>) => {
    setQuestions((current) => current.map((question) => {
      if (question.key === key) return { ...question, ...patch };
      if (patch.key && question.visibilityRule?.questionKey === key) {
        return { ...question, visibilityRule: { ...question.visibilityRule, questionKey: patch.key } };
      }
      return question;
    }));
    setError('');
    setNotice('');
  };

  const normalizeOrder = (items: LeadQuestion[]) => items.map((question, index) => ({ ...question, sortOrder: (index + 1) * 10 }));
  const move = (key: string, direction: -1 | 1) => {
    const items = [...ordered];
    const index = items.findIndex((question) => question.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setQuestions(normalizeOrder(items));
  };

  const duplicate = (question: LeadQuestion) => {
    const index = ordered.findIndex((item) => item.key === question.key);
    const items = [...ordered];
    items.splice(index + 1, 0, {
      ...question,
      id: undefined,
      key: `${question.key}_copy_${Math.random().toString(36).slice(2, 6)}`,
      label: `${question.label} (copy)`,
      options: [...question.options],
    });
    setQuestions(normalizeOrder(items));
  };

  const remove = (key: string) => setQuestions((current) => normalizeOrder(current.filter((question) => question.key !== key)));
  const add = (type: QuestionType) => setQuestions((current) => [...current, newQuestion(type, (current.length + 1) * 10)]);

  const save = async (): Promise<LeadForm | null> => {
    if (name.trim().length < 2 || questions.filter((question) => question.type !== 'section').length === 0) {
      setError('Add a questionnaire name and at least one question.');
      return null;
    }
    const keys = questions.map((question) => question.key);
    if (keys.some((key) => !/^[a-z][a-z0-9_]*$/.test(key)) || new Set(keys).size !== keys.length) {
      setError('Every field key must be unique and use lower-case letters, numbers and underscores, beginning with a letter.');
      return null;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveLeadForm({
        name: name.trim(),
        description: description.trim(),
        privacyNotice: privacyNotice.trim(),
        questions: normalizeOrder(ordered),
      }, savedForm?.id);
      setSavedForm(saved);
      setQuestions(copyQuestions(saved.questions));
      setNotice('Draft saved.');
      onSaved(saved);
      return saved;
    } catch (saveError) {
      setError(messageFor(saveError));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      const current = await save();
      if (!current) return;
      const result = await publishLeadForm(current.id);
      let publicLink = result.link ?? null;
      if (!publicLink) publicLink = await createLeadFormLink(current.id, { kind: 'generic' });
      setSavedForm(result.form);
      setLink(publicLink);
      setNotice('Questionnaire published and ready to share.');
      onSaved(result.form);
    } catch (publishError) {
      setError(messageFor(publishError));
    } finally {
      setPublishing(false);
    }
  };

  const publicUrl = link?.publicPath || link?.token
    ? `${window.location.origin}${link.publicPath || `/mesaleads/q/${link.token}`}`
    : '';
  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setNotice('Public questionnaire link copied.');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <button onClick={onClose} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-800"><ArrowLeft className="h-4 w-4" /> Forms</button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold text-slate-900">{savedForm ? 'Edit questionnaire' : 'New questionnaire'}</h1>
          <p className="mt-0.5 text-xs text-slate-500">Draft changes are versioned when you publish.</p>
        </div>
        <button onClick={() => void save()} disabled={locked || saving || publishing} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 hover:border-blue-300 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</button>
        <button onClick={() => void publish()} disabled={locked || saving || publishing} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />} {locked ? 'Published' : 'Publish'}</button>
      </div>

      {(error || notice || link) && (
        <div className="mb-4 space-y-2">
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>}
          {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {notice}</div>}
          {link && (
            <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-blue-900">Public customer page</p>
                <p className="mt-1 truncate font-mono text-[11px] text-blue-700">{publicUrl}</p>
              </div>
              <button onClick={() => void copyLink()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-bold text-blue-800 ring-1 ring-blue-200 hover:bg-blue-100"><Clipboard className="h-4 w-4" /> Copy link</button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr),minmax(360px,0.85fr)]">
        <fieldset disabled={locked} className="min-w-0 space-y-4 disabled:opacity-70">
          <legend className="sr-only">Questionnaire editor</legend>
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Settings2 className="h-4 w-4 text-blue-700" /> Form details</div>
            <div className="mt-4 grid gap-4">
              <label><span className="text-xs font-bold text-slate-700">Questionnaire name</span><input value={name} onChange={(event) => setName(event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
              <label><span className="text-xs font-bold text-slate-700">Customer introduction</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={`mt-1.5 ${inputClass} resize-y`} /></label>
              <label><span className="text-xs font-bold text-slate-700">Privacy notice and purpose</span><textarea value={privacyNotice} onChange={(event) => setPrivacyNotice(event.target.value)} rows={3} className={`mt-1.5 ${inputClass} resize-y`} /><span className="mt-1 block text-[11px] leading-4 text-slate-400">Customers must acknowledge this notice before submitting.</span></label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Questions</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Use sections to create a clear multi-step customer form.</p>
              </div>
              <div className="flex items-center gap-2">
                <select aria-label="Question type to add" id="question-type" defaultValue="short_text" className="min-h-10 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700">
                  {QUESTION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
                <button onClick={() => { const select = document.getElementById('question-type') as HTMLSelectElement; add(select.value as QuestionType); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white hover:bg-blue-800"><Plus className="h-4 w-4" /> Add</button>
              </div>
            </div>
            <div className="space-y-3 p-3 sm:p-4">
              {ordered.map((question, index) => {
                const previousQuestions = ordered.slice(0, index).filter((item) => item.type !== 'section');
                const conditional = Boolean(question.visibilityRule);
                return (
                  <article key={`${question.id ?? 'draft'}-${index}`} className={`rounded-xl border p-3.5 sm:p-4 ${question.type === 'section' ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),170px]">
                          <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{question.type === 'section' ? 'Section title' : 'Question label'}</span><input value={question.label} onChange={(event) => update(question.key, { label: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
                          <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Type</span><select value={question.type} onChange={(event) => update(question.key, { type: event.target.value as QuestionType, options: ['single_select', 'multi_select'].includes(event.target.value) && question.options.length === 0 ? ['Option 1', 'Option 2'] : question.options })} className={`mt-1 ${inputClass}`}>{QUESTION_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
                        </div>
                        <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Helper text</span><input value={question.helpText} onChange={(event) => update(question.key, { helpText: event.target.value })} className={`mt-1 ${inputClass}`} placeholder="Explain what information is needed" /></label>
                        {question.type !== 'section' && (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Field key</span><input value={question.key} onChange={(event) => update(question.key, { key: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} className={`mt-1 ${inputClass} font-mono`} /></label>
                              <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Placeholder</span><input value={question.placeholder} onChange={(event) => update(question.key, { placeholder: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
                            </div>
                            {['single_select', 'multi_select'].includes(question.type) && <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Options, one per line</span><textarea value={question.options.join('\n')} onChange={(event) => update(question.key, { options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} rows={3} className={`mt-1 ${inputClass} resize-y`} /></label>}
                            {question.type === 'number' && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Minimum value</span><input type="number" value={typeof question.validation?.min === 'number' ? question.validation.min : ''} onChange={(event) => update(question.key, { validation: { ...question.validation, min: event.target.value === '' ? undefined : Number(event.target.value) } })} className={`mt-1 ${inputClass}`} /></label>
                                <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maximum value</span><input type="number" value={typeof question.validation?.max === 'number' ? question.validation.max : ''} onChange={(event) => update(question.key, { validation: { ...question.validation, max: event.target.value === '' ? undefined : Number(event.target.value) } })} className={`mt-1 ${inputClass}`} /></label>
                              </div>
                            )}
                            {['short_text', 'long_text', 'email', 'phone'].includes(question.type) && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Minimum characters</span><input type="number" min="0" value={typeof question.validation?.minLength === 'number' ? question.validation.minLength : ''} onChange={(event) => update(question.key, { validation: { ...question.validation, minLength: event.target.value === '' ? undefined : Number(event.target.value) } })} className={`mt-1 ${inputClass}`} /></label>
                                <label><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maximum characters</span><input type="number" min="1" value={typeof question.validation?.maxLength === 'number' ? question.validation.maxLength : ''} onChange={(event) => update(question.key, { validation: { ...question.validation, maxLength: event.target.value === '' ? undefined : Number(event.target.value) } })} className={`mt-1 ${inputClass}`} /></label>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={question.required} onChange={(event) => update(question.key, { required: event.target.checked })} className="h-4 w-4 rounded text-blue-700" /> Required</label>
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={conditional} disabled={previousQuestions.length === 0} onChange={(event) => update(question.key, { visibilityRule: event.target.checked ? { questionKey: previousQuestions[0]?.key ?? '', operator: 'equals', value: '' } : null })} className="h-4 w-4 rounded text-blue-700" /> Conditional</label>
                            </div>
                            {conditional && question.visibilityRule && (
                              <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
                                <select aria-label="Conditional question" value={question.visibilityRule.questionKey} onChange={(event) => update(question.key, { visibilityRule: { ...question.visibilityRule!, questionKey: event.target.value } })} className={inputClass}>{previousQuestions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
                                <select aria-label="Conditional operator" value={question.visibilityRule.operator} onChange={(event) => update(question.key, { visibilityRule: { ...question.visibilityRule!, operator: event.target.value as VisibilityRule['operator'] } })} className={inputClass}><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option></select>
                                {(() => {
                                  const source = previousQuestions.find((item) => item.key === question.visibilityRule?.questionKey);
                                  if (source?.type === 'yes_no') {
                                    return <select aria-label="Conditional value" value={String(question.visibilityRule?.value ?? '')} onChange={(event) => update(question.key, { visibilityRule: { ...question.visibilityRule!, value: event.target.value === 'true' } })} className={inputClass}><option value="">Choose answer</option><option value="true">Yes</option><option value="false">No</option></select>;
                                  }
                                  if (source && ['single_select', 'multi_select'].includes(source.type)) {
                                    return <select aria-label="Conditional value" value={String(question.visibilityRule?.value ?? '')} onChange={(event) => update(question.key, { visibilityRule: { ...question.visibilityRule!, value: event.target.value } })} className={inputClass}><option value="">Choose answer</option>{source.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}</select>;
                                  }
                                  return <input aria-label="Conditional value" value={String(question.visibilityRule?.value ?? '')} onChange={(event) => update(question.key, { visibilityRule: { ...question.visibilityRule!, value: event.target.value } })} className={inputClass} placeholder="Value" />;
                                })()}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button onClick={() => move(question.key, -1)} disabled={index === 0} aria-label={`Move ${question.label} up`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button onClick={() => move(question.key, 1)} disabled={index === ordered.length - 1} aria-label={`Move ${question.label} down`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        <button onClick={() => duplicate(question)} aria-label={`Duplicate ${question.label}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-700"><Copy className="h-4 w-4" /></button>
                        <button onClick={() => remove(question.key)} aria-label={`Delete ${question.label}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </fieldset>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Eye className="h-4 w-4 text-blue-700" /> Customer preview</div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">MOBILE FIRST</span>
            </div>
            <div className="bg-slate-50 p-4">
              <div className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Requirement form</p>
                <h2 className="mt-1 text-lg font-extrabold text-slate-900">{name || 'Untitled questionnaire'}</h2>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">{description}</p>
                <div className="mt-4 space-y-4">{ordered.map((question) => <PreviewField key={question.key} question={question} />)}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
