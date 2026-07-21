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
  {
    text: "From the very beginning, Justin made us feel like more than just another transaction. He took the time to understand exactly what we were looking for and was always available to answer questions and offer honest advice. We always felt supported and knew he genuinely cared about helping us make the right decisions. Thanks to his hard work and dedication, we ended up in a home that is an even better fit than we imagined. We're so thankful to have had Justin in our corner and wouldn't hesitate to recommend him.",
    author: 'John H.',
    date: 'June 2026',
  },
  {
    text: 'I cannot say enough good things about Justin! He is very personable and easy to communicate with. His professionalism is unmatched and when talking with him you do not feel pressured, you instantly know you are in good hands. He is a man who knows his craft and I would recommend to anyone looking to list and/or buy!',
    author: 'Samantha B.',
    date: 'January 2026',
  },
  {
    text: "We interviewed a few different real estate agents, and Justin was by far the standout. From the beginning, he impressed us with his professionalism, knowledge, and genuine care for our needs. We feel very fortunate to have met him and to have had him guide us through the process. His communication and attention to detail made everything smooth and stress-free. We've already referred Justin to a number of our friends who are looking for help, and we'll continue to recommend him to anyone who needs an outstanding realtor.",
    author: 'Pat R.',
    date: 'September 2025',
  },
  {
    text: 'Justin was really great to work with. He took the time to understand what we were looking for and guided us through everything without pressure. It made a big difference having someone we could trust throughout the process. Highly recommended if you need someone on your side.',
    author: 'Robert M.',
    date: 'April 2026',
  },
  {
    text: `If I could give Justin more than 5 stars, I would. He's the man! From first contacting him, to the closing of our house he was outstanding to deal with. Wasn't easy as we were moving from an hour and a half away, and had him driving all over the London area to look at houses. He was very patient and knew exactly what we were looking for in a neighbourhood and house. Went above and beyond by contacting us when things were slow, and getting in the "dirty" areas of a house/property to check things out for us. He knows his stuff. We dealt with a couple other realtors back home, and can honestly say Justin is the only one who we knew really cares about his clients. Also, doesn't hurt that he's pretty damn funny. 1 week in and we're loving our new home and neighbourhood. Thank you Justin!`,
    author: 'Scott C.',
    date: 'December 2025',
  },
  {
    text: 'Justin was very attentive to our wants and needs, and really made sure we got what we were looking for. He was available for our every question as first-time homebuyers! Thank you, Justin!',
    author: 'Kate N.',
    date: 'April 2026',
  },
  {
    text: "As fairly new immigrants to Canada, we were quite anxious and skeptical about the whole home-buying idea. We feel fortunate to have met Justin. His forthcoming attitude and knowledge of his profession put us at ease right at the onset of our journey. He answered a million questions, was always 100% responsive and clarified our doubts. As other reviewers have highlighted, we also never felt any sort of haste or pressure into a purchase. Our first home-buying process was about a year long and we saw tens of properties with Justin, and we always found him full of zeal. And we finally found a very nice property in an amazing neighborhood a few weeks ago. We want to once again, thank him for his support and guidance and we highly recommend him to all out there looking to buy or sell their properties. We wish Justin and his hundreds of potential clients the best of luck. Thank you.\n\nP.S. Our 5-year old daughter, who's otherwise a very shy kid, absolutely loved him!",
    author: 'Omair B.',
    date: 'September 2025',
  },
  {
    text: 'As first time home buyers we were happy to have Justin as our agent. He is very knowledgeable, patient, and was able to effortlessly guide us through the process. He is very responsive and booked us showings that met our needs. Thank you Justin!',
    author: 'Rochelle D.',
    date: 'November 2025',
  },
  {
    text: "Justin has made the process of finding a place in London effortless and I cannot thank him enough for how simple everything was once he was involved! Justin is responsive, respectful, and extremely helpful. He keeps you in the loop 100% of the time and you can tell he has your best interest in mind! If you're looking for a place in London, definitely reach out!",
    author: 'Noah R.',
    date: 'December 2025',
  },
  {
    text: 'Justin was an amazing help for my first home buying experience. Extremely knowledgeable and professional. Explained the process and steps clearly. Helped navigate a difficult market and numerous bumps along the way. Was on my side when inspection showed serious issues and assisted with pulling the offer. Justin always had my best interest in mind and took the extra time and effort to make sure I ended up with a great home.',
    author: 'Jacquelyn F.',
    date: 'July 2025',
  },
  {
    text: "We can't say enough good things about Justin! He is knowledgeable, professional, and genuinely kind and patient. He guided us through every step of the process, never making us feel rushed and always making sure we understood everything. By the end of our first home-buying journey, it didn't just feel like we had an amazing realtor—we felt like we had a friend who truly cared about us and our journey. We're so happy to have worked with him and would highly recommend him to anyone looking for an amazing realtor!",
    author: 'Samra K.',
    date: 'September 2025',
  },
  {
    text: 'We could not recommend Justin enough as first-time home buyers. From house hunting to finalizing our offer, we always felt confident and supported. There was never any pressure and we always felt like a priority as clients. Not only is Justin knowledgeable about the housing market, he knows his way around a house as well, which was super helpful! His experience and down-to-earth personality were much appreciated during the process. Thanks Justin for helping us secure an amazing first home!',
    author: 'Meg B.',
    date: 'July 2025',
  },
];
