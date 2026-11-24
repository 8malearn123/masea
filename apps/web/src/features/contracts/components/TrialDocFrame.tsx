import { useState } from 'react';

/** إطار مستند عقد التجربة: يأخذ ارتفاع الصفحة نفسها (يتصغّر على الجوال دون مساحة فارغة). */
export function TrialDocFrame({
  html,
  title,
  testId,
}: {
  html: string;
  title: string;
  testId?: string;
}) {
  const [height, setHeight] = useState(1150);
  return (
    <iframe
      title={title}
      data-testid={testId}
      srcDoc={html}
      onLoad={(e) => {
        const doc = e.currentTarget.contentDocument;
        // الخطوط والصورة قد تغيّر الارتفاع بعد التحميل
        const measure = () => {
          const page = doc?.querySelector('.page');
          if (page) setHeight(Math.ceil(page.getBoundingClientRect().bottom) + 16);
        };
        measure();
        setTimeout(measure, 400);
      }}
      style={{ height }}
      className="w-full rounded-xl border border-navy-100 bg-white"
    />
  );
}
