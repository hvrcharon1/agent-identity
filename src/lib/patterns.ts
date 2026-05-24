import type { AuthPattern } from './types';

export const AUTH_PATTERNS: AuthPattern[] = [
  {
    id: 'individual-user-auth',
    name: 'Individual user auth',
    description:
      "Each request carries the calling user's own token. The agent forwards it or exchanges it for a scoped downstream token. Access reflects exactly what that user is entitled to - no more.",
    badgeLabel: 'Recommended for variable access',
    recommended: true,
    flowNodes: [
      { label: 'User N',        sublabel: 'any user',        variant: 'blue'    },
      { label: 'User N token',  sublabel: 'per-user',        variant: 'blue'    },
      { label: 'Agent',         sublabel: 'passes through',  variant: 'default' },
      { label: 'Auth check',    sublabel: 'individual ACL',  variant: 'default' },
      { label: 'Resource',      sublabel: 'user-scoped',     variant: 'green'   },
    ],
  },
  {
    id: 'fixed-credential',
    name: 'Fixed credential',
    description:
      "A single credential lives in the agent's config. Every user gets identical access. Fastest to set up; right for tools where all users are equal - shared task boards, internal wikis.",
    badgeLabel: 'Best for uniform-access tools',
    flowNodes: [
      { label: 'User 1/2/3',      sublabel: 'any user',       variant: 'default' },
      { label: 'Agent',           sublabel: 'same key always', variant: 'default' },
      { label: 'Fixed Auth',      sublabel: 'shared cred',     variant: 'red'     },
      { label: 'Shared resource', sublabel: 'all users equal', variant: 'green'   },
    ],
  },
  {
    id: 'context-switched',
    name: 'Context-switched credentials',
    description:
      "Agent inspects the task - shared infrastructure uses the fixed credential, personal data uses the user's delegated token. Rules are explicit, logged, and auditable.",
    badgeLabel: 'Hybrid: precise and traceable',
    flowNodes: [
      { label: 'Task arrives', sublabel: 'with user context',  variant: 'amber'   },
      { label: 'Task type?',   sublabel: 'shared vs personal', variant: 'amber'   },
      { label: 'Select cred',  sublabel: 'fixed or delegated', variant: 'amber'   },
      { label: 'Auth check',   sublabel: 'right scope',        variant: 'default' },
      { label: 'Resource',     sublabel: 'precise access',     variant: 'green'   },
    ],
  },
  {
    id: 'token-exchange',
    name: 'Token exchange / impersonation',
    description:
      'Agent holds an elevated credential and exchanges it for a scoped user token at runtime - OAuth token exchange, AWS STS assume-role. Powerful but requires strict scope constraints.',
    badgeLabel: 'Advanced - needs strict scope limits',
    flowNodes: [
      { label: 'Agent',            sublabel: 'elevated cred',  variant: 'default' },
      { label: 'Token exchange',   sublabel: 'STS / OAuth',    variant: 'amber'   },
      { label: 'Scoped user token',sublabel: 'user N scope',   variant: 'blue'    },
      { label: 'Resource',         sublabel: 'user-scoped',    variant: 'green'   },
    ],
  },
];
