import { AREAS } from './areas';
import { SERVICES } from './services';
import { BLOG_POSTS } from './blog';

export interface FaqEntry {
  question: string;
  answer: string;
  sourceLabel: string;
  url: string;
}

export const FAQ_INDEX: FaqEntry[] = [
  ...AREAS.flatMap((a) =>
    (a.faqs ?? []).map((f) => ({
      question: f.q,
      answer: f.a,
      sourceLabel: `${a.name} area guide`,
      url: `/areas/${a.slug}/`,
    }))
  ),
  ...SERVICES.flatMap((s) =>
    (s.faqs ?? []).map((f) => ({
      question: f.q,
      answer: f.a,
      sourceLabel: s.name,
      url: `/services/${s.slug}/`,
    }))
  ),
  ...BLOG_POSTS.flatMap((p) =>
    (p.faqs ?? []).map((f) => ({
      question: f.question,
      answer: f.answer,
      sourceLabel: p.title,
      url: `/blog/${p.slug}/`,
    }))
  ),
];
