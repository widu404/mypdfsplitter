const FAQ_ITEMS = [
  {
    question: "Is my PDF uploaded to a server?",
    answer:
      "No. PDF Splitter runs entirely in your browser using JavaScript — your file is read, split, and downloaded on your own device and is never sent anywhere over the network.",
  },
  {
    question: "Is this PDF splitter free to use?",
    answer:
      "Yes, it's completely free, with no account or sign-up required. Just open the page and upload a file.",
  },
  {
    question: "Is there a limit on PDF file size?",
    answer:
      "There's no hard limit, but files over 100MB will show a warning since very large PDFs can be slow to process on some devices. Performance depends on your browser and hardware.",
  },
  {
    question: "Can I split a PDF into more than two files at once?",
    answer:
      "Yes. Add as many splits as you need, each with its own name and page range, then click \"Split & Download All\" to generate every file in one go.",
  },
  {
    question: "Do I get separate files or one ZIP download?",
    answer:
      "If you create a single split, you get that one PDF directly. If you create two or more, they're automatically bundled into a single ZIP file so you don't have to download each one individually.",
  },
  {
    question: "What if my PDF has a cover page or front matter before page 1?",
    answer:
      "Use the \"Front matter pages\" setting to tell the tool how many pages come before your real page 1 — or just click the thumbnail where your content actually starts. Every page number you type is then automatically mapped to the correct physical page.",
  },
  {
    question: "Can I preview a page before splitting?",
    answer:
      "Yes. Click the eye icon next to any start or end page to open a full preview of that page, with arrows to browse forward and backward without closing it.",
  },
  {
    question: "Does this work on mobile devices?",
    answer:
      "Yes, the page is fully responsive and works on phones and tablets, though splitting very large PDFs may be faster on a desktop browser.",
  },
];

export default function Faq() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <section className="mt-12 w-full max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900">Frequently Asked Questions</h2>
      <div className="mt-4 flex flex-col gap-3">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.question}
            className="group rounded-xl border border-gray-200 bg-white p-4 open:shadow-sm"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-gray-800 marker:content-none">
              <span className="flex items-center justify-between gap-3">
                {item.question}
                <span className="shrink-0 text-gray-400 transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 text-sm text-gray-600">{item.answer}</p>
          </details>
        ))}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
    </section>
  );
}
