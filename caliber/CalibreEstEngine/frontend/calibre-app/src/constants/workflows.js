import {
  IconHelpCircle,
  IconCalculator,
  IconChartBar,
  IconAdjustments,
  IconTrendingUp,
} from '@tabler/icons-react';

// Access is decided by CARD_ACCESS in roles.js. This file previously also
// carried allowedRoles/requiresAdmin/roleModeLabels — a second, unused role
// model that disagreed with CARD_ACCESS; removed so there is one answer.
export const WORKFLOWS = [
  {
    id: 1,
    num: '01',
    title: 'What / How to Estimate',
    description:
      'Explore estimation methodology, templates, and get AI-guided coaching from EVA on best practices.',
    color: '#00D4FF',
    glowColor: 'rgba(0, 212, 255, 0.2)',
    borderHover: 'rgba(0, 212, 255, 0.6)',
    gradientFrom: 'rgba(0, 212, 255, 0.06)',
    Icon: IconHelpCircle,
    colorClass: 'cyan',
    route: '/estimate/guide',
  },
  {
    id: 2,
    num: '02',
    title: 'Estimate / Re-estimate / View',
    description:
      'Create new estimates, update existing ones, or review your team\'s active project estimates in real time.',
    color: '#34D399',
    glowColor: 'rgba(52, 211, 153, 0.2)',
    borderHover: 'rgba(52, 211, 153, 0.6)',
    gradientFrom: 'rgba(52, 211, 153, 0.06)',
    Icon: IconCalculator,
    colorClass: 'green',
    route: '/estimate/create',
  },
  {
    id: 3,
    num: '03',
    title: 'Compare Against Benchmarks',
    description:
      'Validate your estimates against baselined benchmarks and historical project actuals.',
    color: '#FFB347',
    glowColor: 'rgba(255, 179, 71, 0.2)',
    borderHover: 'rgba(255, 179, 71, 0.6)',
    gradientFrom: 'rgba(255, 179, 71, 0.06)',
    Icon: IconChartBar,
    colorClass: 'amber',
    route: '/estimate/benchmark',
  },
  {
    id: 4,
    num: '04',
    title: 'Calibrate Your Estimation Engine',
    description:
      'Tune model parameters, adjust weights, and continuously improve Calibre\'s estimation accuracy.',
    color: '#A78BFA',
    glowColor: 'rgba(167, 139, 250, 0.2)',
    borderHover: 'rgba(167, 139, 250, 0.6)',
    gradientFrom: 'rgba(167, 139, 250, 0.06)',
    Icon: IconAdjustments,
    colorClass: 'purple',
    route: '/calibrate',
  },
  {
    id: 5,
    num: '05',
    title: 'ROI & AI Cost Computation',
    description:
      'Compute real-time AI token infrastructure costs, RAG efficiency savings, and financial ROI for estimation workflows.',
    color: '#F5A400',
    glowColor: 'rgba(245, 164, 0, 0.2)',
    borderHover: 'rgba(245, 164, 0, 0.6)',
    gradientFrom: 'rgba(245, 164, 0, 0.06)',
    Icon: IconTrendingUp,
    colorClass: 'gold',
    route: '/estimate/roi-cost',
  },
];

