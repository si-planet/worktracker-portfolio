import {z} from 'zod';
// Use Zod's supported interpreter under strict CSP; never enable unsafe-eval.
z.config({jitless:true});
