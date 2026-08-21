import { describe, expect, it } from 'vitest';
import { publicSubmissionSchema } from './schemas';

describe('MesaLeads public submission limits', () => {
  it('rejects an aggregate attachment body larger than ten MiB even when each file is valid', () => {
    const encoded = 'A'.repeat(7_000_001);
    const result = publicSubmissionSchema.safeParse({
      submissionKey: 'aggregate_upload_1234567890',
      answers: {},
      attachments: [
        { questionKey: 'drawing_a', fileName: 'a.pdf', mimeType: 'application/pdf', dataBase64: encoded },
        { questionKey: 'drawing_b', fileName: 'b.pdf', mimeType: 'application/pdf', dataBase64: encoded },
      ],
      consent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.attachments).toContain('Attachments must be 10 MB or smaller in total.');
    }
  });
});
