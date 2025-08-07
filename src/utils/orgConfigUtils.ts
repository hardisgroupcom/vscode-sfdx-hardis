
import * as fs from 'fs';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import sortArray from 'sort-array';


export interface MajorOrg {
    branchName: string;
    orgType: 'prod' | 'preprod' | 'uat' | 'uatrun' | 'integration' | 'other';
    alias?: string;
    mergeTargets: string[];
    level: number;
}

export async function listMajorOrgs(): Promise<MajorOrg[]> {
    const branchConfigPattern = '**/config/branches/.sfdx-hardis.*.yml';
    const configFiles = await glob(branchConfigPattern);
    const majorOrgs: MajorOrg[] = [];

    for (const configFile of configFiles) {
        const props = (yaml.load(fs.readFileSync(configFile, 'utf-8')) || {}) as any;
        const branchNameRegex = /\.sfdx-hardis\.(.*)\.yml/gi;
        const m = branchNameRegex.exec(configFile);
        if (!m) { continue; }
        const branchName = m[1];
        let orgType: MajorOrg['orgType'] = 'other';
        let level = 40;
        if (isProduction(branchName)) {
            orgType = 'prod';
            level = 100;
        } else if (isPreprod(branchName)) {
            orgType = 'preprod';
            level = 90;
        } else if (isUatRun(branchName)) {
            orgType = 'uatrun';
            level = 80;
        } else if (isUat(branchName)) {
            orgType = 'uat';
            level = 70;
        } else if (isIntegration(branchName)) {
            orgType = 'integration';
            level = 50;
        }
        const mergeTargets = Array.isArray(props.mergeTargets) ? props.mergeTargets : guessMatchingMergeTargets(branchName, orgType, configFiles.map(f => f.replace(/^.*\.sfdx-hardis\.|\.yml$/g, '')));
        majorOrgs.push({
            branchName,
            orgType,
            alias: props.alias,
            mergeTargets,
            level
        });
    }

    // Sort by level (desc), then branchName (asc)
    return sortArray(majorOrgs, { by: ['level', 'branchName'], order: ['desc', 'asc'] });
}


function guessMatchingMergeTargets(branchName: string, orgType: string, allBranchNames: string[]): string[] {
    if (orgType === 'prod') {
        return [];
    } else if (orgType === 'preprod') {
        return allBranchNames.filter(isProduction);
    } else if (orgType === 'uat' || orgType === 'uatrun') {
        return allBranchNames.filter(isPreprod);
    } else if (orgType === 'integration') {
        return allBranchNames.filter(isUat);
    }
    // fallback: no guess
    return [];
}

export function isProduction(branchName: string) {
    return branchName.toLowerCase().startsWith("prod") || branchName.toLowerCase().startsWith("main");
}

export function isPreprod(branchName: string) {
    return branchName.toLowerCase().startsWith("preprod") || branchName.toLowerCase().startsWith("staging");
}

export function isUat(branchName: string) {
    return (branchName.toLowerCase().startsWith("uat") || branchName.toLowerCase().startsWith("recette")) && !branchName.toLowerCase().includes("run");
}

export function isIntegration(branchName: string) {
    return branchName.toLowerCase().startsWith("integ");
}

export function isUatRun(branchName: string) {
    return (branchName.toLowerCase().startsWith("uat") || branchName.toLowerCase().startsWith("recette")) && branchName.toLowerCase().includes("run");
}