import { el } from '../dom';

/**
 * The Rulebook — a glossary of the acronyms an Express Entry applicant runs into.
 *
 * Some of these are official IRCC terms and some are community shorthand; the
 * entries say which, because confusing the two is how people end up expecting a
 * step that does not officially exist.
 */

interface Term {
  term: string;
  expansion?: string;
  definition: string;
}

interface Section {
  title: string;
  terms: Term[];
}

const SECTIONS: Section[] = [
  {
    title: 'The draw',
    terms: [
      {
        term: 'CRS',
        expansion: 'Comprehensive Ranking System',
        definition:
          'The score, out of 1,200, used to rank profiles in the Express Entry pool. Points come from age, education, language ability, work experience and a few combinations of those.',
      },
      {
        term: 'Pool',
        definition:
          'The set of eligible profiles waiting to be invited. A profile stays in the pool for up to 12 months, after which it must be resubmitted.',
      },
      {
        term: 'Round of invitations',
        expansion: 'a "draw"',
        definition:
          'The periodic selection of top-ranked candidates from the pool. IRCC publishes the date, the number of invitations and the cut-off score for every round.',
      },
      {
        term: 'Cut-off',
        definition: 'The lowest CRS score invited in a round.',
      },
      {
        term: 'ITA',
        expansion: 'Invitation to Apply',
        definition:
          'Issued to candidates at or above the cut-off. It comes with a deadline — currently 60 days — to submit a complete application.',
      },
      {
        term: 'Tie-break rule',
        definition:
          'When more candidates share the cut-off score than there are invitations, only those who entered the pool before the published tie-break timestamp are invited. This is why the exact second is published.',
      },
      {
        term: 'Category-based draw',
        definition:
          'A round restricted to candidates who meet a specific category — healthcare, trades, French-language proficiency and others — rather than open to the highest scores overall. Cut-offs in these rounds are often far below the general ones.',
      },
    ],
  },
  {
    title: 'The application',
    terms: [
      {
        term: 'eAPR',
        expansion: 'electronic Application for Permanent Residence',
        definition: 'The full application submitted after receiving an ITA.',
      },
      {
        term: 'AOR',
        expansion: 'Acknowledgement of Receipt',
        definition:
          'Confirms IRCC has accepted a complete eAPR. This is the date processing times are measured from, and the date this site keys its queue estimates on.',
      },
      {
        term: 'BIL',
        expansion: 'Biometrics Instruction Letter',
        definition:
          'The request to give fingerprints and a photo, usually one of the first things to arrive after AOR.',
      },
      {
        term: 'IME',
        expansion: 'Immigration Medical Exam',
        definition:
          'The medical examination, done by a panel physician. Results are sent to IRCC directly rather than to you.',
      },
      {
        term: 'Eligibility',
        definition:
          'The assessment of whether you meet the program’s requirements and whether the CRS points you claimed hold up against your documents.',
      },
      {
        term: 'Background check',
        definition:
          'Criminality and security screening. It runs alongside eligibility rather than after it, which is why the two can complete in either order.',
      },
      {
        term: 'ADR',
        expansion: 'Additional Document Request',
        definition:
          'IRCC asking for more information mid-processing. It can arrive at any stage and is not by itself a bad sign, but it does have a deadline.',
      },
      {
        term: 'P1 / P2',
        expansion: 'PR portal 1 and 2 — community shorthand',
        definition:
          'The two confirmation-portal links issued after approval. The first collects your photo and address; the second delivers the COPR. IRCC does not use these names officially.',
      },
      {
        term: 'PPR',
        expansion: 'Passport Request — community shorthand',
        definition:
          'The equivalent step for applicants who must submit a passport for visa counterfoil. Inland applicants generally go through the portals instead.',
      },
      {
        term: 'COPR',
        expansion: 'Confirmation of Permanent Residence',
        definition: 'The document confirming PR has been granted. The end of the file.',
      },
    ],
  },
  {
    title: 'Programs',
    terms: [
      {
        term: 'CEC',
        expansion: 'Canadian Experience Class',
        definition: 'For candidates with skilled work experience gained in Canada.',
      },
      {
        term: 'FSW',
        expansion: 'Federal Skilled Worker',
        definition:
          'Points-assessed program for skilled workers. Canadian experience is not required, but a separate selection-factor threshold applies.',
      },
      {
        term: 'FST',
        expansion: 'Federal Skilled Trades',
        definition: 'For qualified tradespeople meeting the program’s trade and language requirements.',
      },
      {
        term: 'PNP',
        expansion: 'Provincial Nominee Program',
        definition:
          'A provincial nomination adds 600 CRS points, which in practice guarantees an invitation. Enhanced nominations are drawn through Express Entry; base nominations are processed on their own, much slower track.',
      },
    ],
  },
  {
    title: 'Documents and checks',
    terms: [
      {
        term: 'ECA',
        expansion: 'Educational Credential Assessment',
        definition:
          'Verifies foreign education against Canadian standards. Required to claim points for education obtained outside Canada.',
      },
      {
        term: 'NOC',
        expansion: 'National Occupational Classification',
        definition:
          'The code describing an occupation, and the TEER category it falls into. Which code your job maps to determines whether it counts as skilled experience.',
      },
      {
        term: 'Language tests',
        definition:
          'IELTS General Training or CELPIP for English; TEF Canada or TCF Canada for French. Results expire after two years.',
      },
      {
        term: 'GCMS notes',
        expansion: 'Global Case Management System',
        definition:
          'IRCC’s internal case notes, obtainable through an ATIP request by a Canadian citizen, permanent resident, or an authorised representative. Commonly used to see where a file actually sits.',
      },
      {
        term: 'R10',
        definition:
          'Shorthand for the completeness requirements in section 10 of the Immigration and Refugee Protection Regulations. An application missing a required item can be returned as incomplete rather than refused — the ITA deadline still applies.',
      },
    ],
  },
];

export function renderRulebook(): HTMLElement {
  const sectionHosts = new Map<Section, HTMLElement>();
  const count = el('span', {});

  const filter = el('input', {
    class: 'control__input',
    attrs: {
      type: 'search',
      id: 'rulebook-filter',
      placeholder: 'e.g. ADR',
      autocomplete: 'off',
    },
    on: {
      input: (e) => apply((e.target as HTMLInputElement).value),
    },
  });

  const apply = (query: string) => {
    const q = query.trim().toLowerCase();
    let shown = 0;

    for (const [section, host] of sectionHosts) {
      let visible = 0;
      section.terms.forEach((term, i) => {
        const haystack = `${term.term} ${term.expansion ?? ''} ${term.definition}`.toLowerCase();
        const match = q === '' || haystack.includes(q);
        const row = host.children[i + 1] as HTMLElement | undefined;
        if (row) row.hidden = !match;
        if (match) visible++;
      });
      host.hidden = visible === 0;
      shown += visible;
    }

    count.textContent = `${shown} ${shown === 1 ? 'entry' : 'entries'}`;
  };

  const body = el('div', { class: 'paper__body' });

  body.append(
    el('h2', { class: 'paper__title pixel', text: 'Rulebook' }),
    el('p', {
      class: 'paper__note',
      text: 'The acronyms, in the order you tend to meet them. Where a term is community shorthand rather than an official IRCC one, the entry says so.',
    }),
  );

  for (const section of SECTIONS) {
    const host = el(
      'section',
      { class: 'rulebook__section' },
      el('h3', { class: 'rulebook__heading pixel', text: section.title }),
      ...section.terms.map((term) =>
        el(
          'div',
          { class: 'rulebook__entry' },
          el(
            'div',
            { class: 'rulebook__term' },
            el('span', { class: 'rulebook__name pixel', text: term.term }),
            term.expansion
              ? el('span', { class: 'rulebook__expansion', text: term.expansion })
              : null,
          ),
          el('p', { class: 'rulebook__definition', text: term.definition }),
        ),
      ),
    );
    sectionHosts.set(section, host);
    body.append(host);
  }

  const view = el(
    'div',
    {},
    el(
      'div',
      { class: 'controls' },
      el(
        'div',
        { class: 'control' },
        el('label', {
          class: 'control__label',
          text: 'Find a term',
          attrs: { for: 'rulebook-filter' },
        }),
        filter,
      ),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band paper__band--rust' },
        el('span', { text: 'Rulebook' }),
        count,
      ),
      body,
    ),
  );

  apply('');
  return view;
}
