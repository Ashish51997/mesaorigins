import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileUp,
  Loader2,
  LockKeyhole,
  Paperclip,
} from 'lucide-react';
import Logo from '../Logo';
import { ApiError } from '../../lib/apiClient';
import { getPublicLeadForm, getPublicLeadPortal, submitPublicLeadForm } from './api';
import { humanize } from './constants';
import CustomerRequestPortal from './CustomerRequestPortal';
import type { LeadQuestion, PublicLeadForm } from './types';

type AnswerValue = string | number | boolean | string[];
type AnswerMap = Record<string, AnswerValue>;
type Upload = { questionKey: string; fileName: string; mimeType: string; dataBase64: string; size: number };

type Step = {
  key: string;
  title: string;
  description: string;
  questions: LeadQuestion[];
};

const inputClass = 'mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100';

function isVisible(question: LeadQuestion, answers: AnswerMap): boolean {
  const rule = question.visibilityRule;
  if (!rule) return true;
  const current = answers[rule.questionKey];
  if (current === undefined || current === null || current === '' || (Array.isArray(current) && current.length === 0)) return false;
  const value = String(current);
  const expected = String(rule.value ?? '');
  if (rule.operator === 'not_equals') return value !== expected;
  if (rule.operator === 'contains') {
    if (Array.isArray(current)) return current.some((item) => String(item) === expected);
    return value.toLowerCase().includes(expected.toLowerCase());
  }
  return value === expected;
}

function hasValue(value: AnswerValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && String(value).trim().length > 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'We could not submit your requirement. Please check your connection and try again.';
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function newSubmissionKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

async function getPublicJourney(token: string) {
  try {
    return await getPublicLeadForm(token);
  } catch (error) {
    // A generated portal token is intentionally unknown to the form endpoint,
    // so only that generic miss should try the portal endpoint. Preserve
    // precise expired, revoked and unavailable-form errors from invitations.
    if (!(error instanceof ApiError) || error.status !== 404 || error.code !== 'not_found') throw error;
    return getPublicLeadPortal(token);
  }
}

function portalTokenFromPath(path: string | undefined, fallback: string): string {
  if (!path?.startsWith('/mesaleads/q/')) return fallback;
  const value = path.slice('/mesaleads/q/'.length).split(/[?#]/, 1)[0];
  try { return decodeURIComponent(value) || fallback; } catch { return fallback; }
}

function buildSteps(questions: LeadQuestion[]): Step[] {
  const sorted = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  const steps: Step[] = [];
  let current: Step = { key: 'requirements', title: 'Your requirement', description: '', questions: [] };
  for (const question of sorted) {
    if (question.type === 'section') {
      if (current.questions.length > 0) steps.push(current);
      current = {
        key: question.key,
        title: question.label,
        description: question.helpText,
        questions: [],
      };
      continue;
    }
    current.questions.push(question);
  }
  if (current.questions.length > 0) steps.push(current);
  return steps.length > 0 ? steps : [{ key: 'requirements', title: 'Your requirement', description: '', questions: sorted }];
}

function Field({
  question,
  value,
  error,
  upload,
  onChange,
  onUpload,
}: {
  question: LeadQuestion;
  value: AnswerValue | undefined;
  error?: string;
  upload?: Upload;
  onChange: (value: AnswerValue) => void;
  onUpload: (file: File | null) => Promise<void>;
}) {
  const describedBy = [question.helpText ? `${question.key}-help` : '', error ? `${question.key}-error` : ''].filter(Boolean).join(' ') || undefined;
  const label = (
    <span className="text-sm font-bold text-slate-800">
      {question.label} {question.required && <span className="text-rose-600" aria-hidden="true">*</span>}
    </span>
  );
  const support = (
    <>
      {question.helpText && <p id={`${question.key}-help`} className="mt-1 text-xs leading-5 text-slate-500">{question.helpText}</p>}
      {error && <p id={`${question.key}-error`} className="mt-1.5 text-xs font-semibold text-rose-700">{error}</p>}
    </>
  );

  if (question.type === 'long_text') {
    return (
      <label className="block">
        {label}
        {support}
        <textarea
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
          required={question.required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          rows={4}
          className={`${inputClass} resize-y`}
        />
      </label>
    );
  }

  if (question.type === 'single_select' || question.type === 'yes_no') {
    const options: Array<string | boolean> = question.type === 'yes_no' ? [true, false] : question.options;
    return (
      <fieldset>
        <legend>{label}</legend>
        {support}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const selected = value === option;
            return (
              <label key={String(option)} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 transition ${selected ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}>
                <input type="radio" name={question.key} checked={selected} onChange={() => onChange(option)} className="h-4 w-4 text-blue-700 focus:ring-blue-500" />
                <span className="text-sm font-semibold">{typeof option === 'boolean' ? (option ? 'Yes' : 'No') : humanize(option)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.type === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend>{label}</legend>
        {support}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 transition ${checked ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selected.filter((item) => item !== option) : [...selected, option])}
                  className="h-4 w-4 rounded text-blue-700 focus:ring-blue-500"
                />
                <span className="text-sm font-semibold">{humanize(option)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.type === 'file') {
    return (
      <div>
        {label}
        {support}
        <label className={`mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${error ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50'}`}>
          <FileUp className="h-6 w-6 text-blue-700" />
          <span className="mt-2 text-sm font-bold text-slate-700">{upload ? 'Replace attachment' : 'Choose a file'}</span>
          <span className="mt-1 text-xs text-slate-500">JPG, PNG or PDF · up to 5 MB</span>
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => void onUpload(event.target.files?.[0] ?? null)}
          />
        </label>
        {upload && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{upload.fileName}</span>
            <span className="shrink-0 font-normal">{(upload.size / 1024).toFixed(0)} KB</span>
          </div>
        )}
      </div>
    );
  }

  const inputType = question.type === 'email'
    ? 'email'
    : question.type === 'phone'
      ? 'tel'
      : question.type === 'number'
        ? 'number'
        : question.type === 'date'
          ? 'date'
          : 'text';

  return (
    <label className="block">
      {label}
      {support}
      <input
        type={inputType}
        value={String(value ?? '')}
        onChange={(event) => onChange(question.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
        placeholder={question.placeholder}
        required={question.required}
        min={typeof question.validation?.min === 'number' ? question.validation.min : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={inputClass}
      />
    </label>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-9" />
            <div>
              <p className="font-extrabold leading-none text-slate-900">MesaLeads</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Powered by MesaOrigins</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs font-semibold text-slate-500 sm:flex">
            <LockKeyhole className="h-4 w-4 text-emerald-600" /> Secure requirement form
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

export default function CustomerQuestionnaire({ token }: { token: string }) {
  const query = useQuery({ queryKey: ['mesaleads', 'public-form', token], queryFn: () => getPublicJourney(token), retry: false });
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitPublicLeadForm>> | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submissionKeyRef = useRef(newSubmissionKey());

  const formJourney: PublicLeadForm | null = query.data && query.data.mode !== 'portal' ? query.data : null;
  const steps = useMemo(() => buildSteps(formJourney?.form.questions ?? []), [formJourney?.form.questions]);
  const reviewStep = stepIndex === steps.length;
  const totalSteps = steps.length + 1;
  const currentStep = steps[stepIndex];

  useEffect(() => {
    const previousTitle = document.title;
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existing?.content;
    const robots = existing ?? document.createElement('meta');
    if (!existing) {
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow, noarchive';
    document.title = 'Secure requirement questionnaire · MesaLeads';
    return () => {
      document.title = previousTitle;
      if (existing && previousRobots !== undefined) existing.content = previousRobots;
      else robots.remove();
    };
  }, []);

  useEffect(() => {
    if (formJourney?.form.name) document.title = `${formJourney.form.name} · MesaLeads`;
  }, [formJourney?.form.name]);

  useEffect(() => {
    if (!formJourney?.link.kind) return;
    const draftKey = `mesaleads-form-draft:${token}`;
    if (formJourney.link.kind === 'invitation') {
      window.sessionStorage.removeItem(draftKey);
      return;
    }
    const saved = window.sessionStorage.getItem(draftKey);
    if (saved) {
      try { setAnswers(JSON.parse(saved) as AnswerMap); } catch { /* ignore a stale draft */ }
    }
  }, [formJourney?.link.kind, token]);

  useEffect(() => {
    if (formJourney?.link.kind !== 'generic') return;
    window.sessionStorage.setItem(`mesaleads-form-draft:${token}`, JSON.stringify(answers));
  }, [answers, formJourney?.link.kind, token]);

  useEffect(() => {
    if (pageError) errorRef.current?.focus();
  }, [pageError]);

  useEffect(() => {
    if (!formJourney?.prefill) return;
    const keys = new Set(formJourney.form.questions.map((question) => question.key));
    const prefill = Object.fromEntries(
      Object.entries(formJourney.prefill).filter(([key]) => keys.has(key)),
    ) as AnswerMap;
    setAnswers((current) => ({ ...prefill, ...current }));
  }, [formJourney]);

  const setAnswer = (questionKey: string, value: AnswerValue) => {
    setAnswers((current) => ({ ...current, [questionKey]: value }));
    setErrors((current) => ({ ...current, [questionKey]: '' }));
    setPageError('');
  };

  const upload = async (question: LeadQuestion, file: File | null) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setErrors((current) => ({ ...current, [question.key]: 'Upload a JPG, PNG or PDF file.' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((current) => ({ ...current, [question.key]: 'The file must be 5 MB or smaller.' }));
      return;
    }
    const existingBytes = Object.entries(uploads).reduce(
      (total, [key, item]) => key === question.key ? total : total + item.size,
      0,
    );
    if (existingBytes + file.size > 10 * 1024 * 1024) {
      setErrors((current) => ({ ...current, [question.key]: 'Attachments must be 10 MB or smaller in total.' }));
      return;
    }
    const dataBase64 = await toBase64(file);
    setUploads((current) => ({
      ...current,
      [question.key]: { questionKey: question.key, fileName: file.name, mimeType: file.type, dataBase64, size: file.size },
    }));
    setAnswer(question.key, file.name);
  };

  const validateStep = (questions: LeadQuestion[]): boolean => {
    const nextErrors: Record<string, string> = {};
    for (const question of questions.filter((item) => isVisible(item, answers))) {
      const value = answers[question.key];
      if (question.required && !hasValue(value)) nextErrors[question.key] = 'This question is required.';
      if (question.type === 'email' && hasValue(value) && !/^\S+@\S+\.\S+$/.test(String(value))) {
        nextErrors[question.key] = 'Enter a valid email address.';
      }
      if (typeof value === 'number') {
        if (typeof question.validation?.min === 'number' && value < question.validation.min) nextErrors[question.key] = `Enter a value of at least ${question.validation.min}.`;
        if (typeof question.validation?.max === 'number' && value > question.validation.max) nextErrors[question.key] = `Enter a value no greater than ${question.validation.max}.`;
      }
      if (typeof value === 'string') {
        if (typeof question.validation?.minLength === 'number' && value.length < question.validation.minLength) nextErrors[question.key] = `Enter at least ${question.validation.minLength} characters.`;
        if (typeof question.validation?.maxLength === 'number' && value.length > question.validation.maxLength) nextErrors[question.key] = `Enter no more than ${question.validation.maxLength} characters.`;
        if (typeof question.validation?.pattern === 'string') {
          try {
            if (!(new RegExp(question.validation.pattern).test(value))) nextErrors[question.key] = 'Enter a value in the requested format.';
          } catch { /* the server also rejects invalid form patterns */ }
        }
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setPageError('Please complete the highlighted questions before continuing.');
      return false;
    }
    setPageError('');
    return true;
  };

  const next = () => {
    if (!currentStep || !validateStep(currentStep.questions)) return;
    setStepIndex((current) => Math.min(current + 1, steps.length));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!consent || submitting) {
      if (!consent) setPageError('Please acknowledge the privacy notice before submitting.');
      return;
    }
    setSubmitting(true);
    setPageError('');
    try {
      const visibleQuestionKeys = new Set(formJourney?.form.questions
        .filter((question) => question.type !== 'section' && isVisible(question, answers))
        .map((question) => question.key) ?? []);
      const visibleAnswers = Object.fromEntries(Object.entries(answers).filter(([key]) => visibleQuestionKeys.has(key)));
      const response = await submitPublicLeadForm(token, {
        submissionKey: submissionKeyRef.current,
        respondent: {
          name: String(answers.contact_name ?? ''),
          email: String(answers.email ?? ''),
          phone: String(answers.phone ?? ''),
        },
        answers: visibleAnswers,
        attachments: Object.values(uploads)
          .filter((item) => visibleQuestionKeys.has(item.questionKey))
          .map(({ size: _size, ...item }) => item),
        consent: true,
      });
      window.sessionStorage.removeItem(`mesaleads-form-draft:${token}`);
      if (response.journeyPath?.startsWith('/mesaleads/q/')) {
        window.history.replaceState(null, '', response.journeyPath);
      }
      setResult(response);
    } catch (submitError) {
      setPageError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  if (query.isLoading) {
    return <Shell><main className="mx-auto flex max-w-3xl items-center justify-center px-4 py-24 text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-700" /> Loading your questionnaire…</main></Shell>;
  }

  if (query.isError || !query.data) {
    return (
      <Shell>
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><LockKeyhole className="h-5 w-5" /></div>
          <h1 className="mt-5 text-xl font-extrabold text-slate-900">This questionnaire is not available</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">The link may have expired, already been submitted, or been withdrawn. Please ask your sales contact for a new link.</p>
        </main>
      </Shell>
    );
  }

  if (result?.portal) {
    return <Shell><CustomerRequestPortal token={portalTokenFromPath(result.journeyPath, result.portalToken ?? token)} initialPortal={result.portal} justSubmitted /></Shell>;
  }

  if (query.data.mode === 'portal') {
    return <Shell><CustomerRequestPortal token={token} initialPortal={query.data.portal} /></Shell>;
  }

  if (result) {
    return (
      <Shell>
        <main className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <div className="rounded-xl border border-emerald-200 bg-white p-6 text-center sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-7 w-7" /></div>
            <h1 className="mt-5 text-2xl font-extrabold text-slate-900">Requirement submitted</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{formJourney?.organization.name} has received your information and will review the technical requirement.</p>
            <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reference</p>
              <p className="mt-1 font-mono text-base font-bold text-slate-900">{result.reference}</p>
            </div>
          </div>
        </main>
      </Shell>
    );
  }

  if (!formJourney) return null;
  const { organization, form } = formJourney;
  const visibleReviewQuestions = form.questions
    .filter((question) => question.type !== 'section' && isVisible(question, answers) && hasValue(answers[question.key]))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <Building2 className="h-4 w-4 text-blue-700" /> {organization.name}
            <span aria-hidden="true">·</span>
            <span>Step {stepIndex + 1} of {totalSteps}</span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{form.name}</h1>
          {form.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{form.description}</p>}
        </div>

        {formJourney.link.kind === 'invitation' && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
            <div><p className="text-xs font-extrabold">One secure link for this request</p><p className="mt-1 text-[11px] leading-5 text-blue-800">Complete the questionnaire here. After submitting, revisit this same URL to check review status, quotations, customer follow-ups and delivery progress.</p></div>
          </div>
        )}

        <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Questionnaire progress" aria-valuemin={1} aria-valuemax={totalSteps} aria-valuenow={stepIndex + 1}>
          <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }} />
        </div>

        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-7 sm:py-5">
            <h2 className="text-lg font-bold text-slate-900">{reviewStep ? 'Review and submit' : currentStep?.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{reviewStep ? 'Check your answers. You can go back to make corrections before submitting.' : currentStep?.description || 'Fields marked with * are required.'}</p>
          </div>

          <div className="space-y-6 px-5 py-5 sm:px-7 sm:py-6">
            {pageError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 outline-none focus:ring-2 focus:ring-rose-300">{pageError}</div>}

            {!reviewStep && currentStep?.questions.filter((question) => isVisible(question, answers)).map((question) => (
              <Field
                key={question.key}
                question={question}
                value={answers[question.key]}
                error={errors[question.key]}
                upload={uploads[question.key]}
                onChange={(value) => setAnswer(question.key, value)}
                onUpload={(file) => upload(question, file)}
              />
            ))}

            {reviewStep && (
              <>
                <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {visibleReviewQuestions.map((question) => {
                    const answer = answers[question.key];
                    return (
                      <div key={question.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,0.42fr),minmax(0,0.58fr)] sm:gap-4">
                        <dt className="text-xs font-semibold text-slate-500">{question.label}</dt>
                        <dd className="break-words text-sm font-medium text-slate-800">{Array.isArray(answer)
                          ? answer.map(humanize).join(', ')
                          : typeof answer === 'boolean'
                            ? (answer ? 'Yes' : 'No')
                            : ['single_select', 'multi_select'].includes(question.type)
                              ? humanize(String(answer))
                              : String(answer)}</dd>
                      </div>
                    );
                  })}
                </dl>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setPageError(''); }} className="mt-0.5 h-4 w-4 rounded text-blue-700 focus:ring-blue-500" />
                  <span className="text-xs leading-5 text-slate-600">
                    I confirm these details are accurate. {form.privacyNotice || `${organization.name} will use them to assess this requirement, contact me, and prepare a technical or commercial proposal.`}
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={() => { setStepIndex((current) => Math.max(0, current - 1)); setPageError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={stepIndex === 0 || submitting}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {reviewStep ? (
              <button type="submit" disabled={submitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? 'Submitting…' : 'Submit requirement'}
              </button>
            ) : (
              <button type="button" onClick={next} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white transition hover:bg-blue-800">
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">Your information is sent securely and is visible only to the organization handling this requirement.</p>
      </main>
    </Shell>
  );
}
