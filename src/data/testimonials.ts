export interface Testimonial {
  text: string;
  author: string;
  date: string;
}

// Add real reviews here as Justin collects them (Google, texts, email, etc.)
// Never add a testimonial that isn't a real, verifiable quote from an actual client.
// Use first name + last initial only (e.g. "Kyle R.") for privacy — not full last names.
export const TESTIMONIALS: Testimonial[] = [
  {
    text: "We can't recommend Justin enough! He sold our house quickly, but when we started to worry about finding our next home, he went above and beyond. Justin reached out to other agents to learn what was coming to the market, helping us get ahead of the competition. Thanks to his hard work and dedication, we found an amazing house we love and got an incredible deal. We're so grateful for everything he did for us.",
    author: 'James M.',
    date: 'June 2026',
  },
  {
    text: "Working with Justin was an absolute pleasure! From day one, he was patient, responsive, and always willing to answer any questions I had. He kept me informed throughout the entire process and guided me in a way that made buying a home feel far less stressful than I expected. He helped us find our home when we didn't think it was possible. Justin is kind, extremely knowledgeable, and truly understands the market and what to look out for. We trusted him completely through the entire house hunting and purchase process, and I'm so grateful we had him as our realtor.",
    author: 'Stef W.',
    date: 'January 2026',
  },
  {
    text: 'Justin is a pleasure to work with! Personable and professional to a tee. Presents accurate and relevant market data enabling easy decision making. Will definitely recommend contracting his services. Hands down a valuable asset to the Oakridge community!',
    author: 'Kyle R.',
    date: 'August 2025',
  },
];
