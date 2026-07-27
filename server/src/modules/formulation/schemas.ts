import { z } from 'zod';

const componentSchema = z.object({
  name: z.string().trim().min(1, 'Component name is required'),
  pct: z.number().min(0).max(100),
  lotId: z.string().trim().default(''),
});

export const formulationCreateSchema = z.object({
  code: z.string().trim().min(1, 'A formulation code is required'),
  product: z.string().trim().default(''),
  components: z.array(componentSchema).min(1, 'Add at least one component'),
});
export type FormulationCreate = z.infer<typeof formulationCreateSchema>;

export const formulationUpdateSchema = z
  .object({
    product: z.string().trim(),
    components: z.array(componentSchema).min(1),
    active: z.boolean(),
  })
  .partial();
export type FormulationUpdate = z.infer<typeof formulationUpdateSchema>;
