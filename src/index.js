console.log("Hello, World!");

const { getInput, setFailed, setOutput } = require('@actions/core');

// Define custom error classes for better error handling
class GithubError extends Error {
    constructor(message) {
        super(`Github API Error: ${message}`);
        this.name = 'GithubError';
    }
}

class ResponseError extends Error {
    constructor(message) {
        super(`Invalid Response Error: ${message}`);
        this.name = 'ResponseError';
    }
}


async function fetchGithubRuns(parentRunID, targetRepo, githubToken) {
    const url = `https://api.github.com/repos/${targetRepo}/actions/runs?event=repository_dispatch&status=completed`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${githubToken}`,
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
    
    if (!response.ok) {
        throw new GithubError(`${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const filteredRuns = data.workflow_runs.filter(run => run.display_title.includes(parentRunID));

    if (filteredRuns.length === 0) {
        console.log(`No runs found for parent_run_id: ${parentRunID}`);
        return null;
    }

    if (filteredRuns.length === 1) {
        console.log(`Found one run for parent_run_id: ${parentRunID}`);
        const successRun = filteredRuns[0];
        return {
            id: successRun.id,
            result: successRun.conclusion,
        };
    }
    
    const filteredRunIDs = filteredRuns.map(run => run.id);
    const filteredRunsString = filteredRunIDs.join(', ');
    throw new ResponseError(`Multiple runs found for parent_run_id: ${parentRunID}. Found: ${filteredRunsString}.`);
}

async function main() {
    console.log("Starting GitHub Actions run polling...");

    const parentRunID = getInput('parent_run_id');
    const targetRepo = getInput('target_repo');
    const githubToken = getInput('github_token');
    const timeout = getInput('timeout') || '30';

    // Log the inputs for debugging
    console.log(`Parent Run ID: ${parentRunID}`);
    console.log(`Target Repository: ${targetRepo}`);
    console.log(`Timeout: ${timeout} minutes`);

    // Validate timeout
    const maxTime = parseInt(timeout) * 60 * 1000;
    if (isNaN(maxTime) || maxTime <= 0) {
        setFailed(`Invalid timeout value: ${timeout}. It should be a positive number.`);
        return;
    }

    let result = null;
    const startTime = Date.now();

    while (Date.now() - startTime < maxTime) {
        try {
            result = await fetchGithubRuns(parentRunID, targetRepo, githubToken);
            if (result) {
                console.log(`Run found with ID: ${result.id}, Result: ${result.result}`);
                setOutput('child_run_id', result.id);
                setOutput('result', result.result);
                return; // Success - exit the function
            }
            // If result is null, continue polling
            console.log('No matching runs found yet, continuing to poll...');
        } catch (error) {
            if (error instanceof GithubError) {
                console.error(`Github API Error: ${error.message}`);
                setFailed(error.message);
                return; // Exit on GitHub API errors
            } else if (error instanceof ResponseError) {
                console.error(`Response Error: ${error.message}`);
                setFailed(error.message);
                return; // Exit on response errors (multiple runs found)
            } else {
                console.error(`Unexpected error: ${error.message}`);
                setFailed(error.message);
                return; // Exit on unexpected errors
            }
        }

        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before retrying
    }

    // If we reach here, we've timed out
    setFailed(`Timeout: No run found after ${timeout} minutes`);
}

// Execute the main function
main().catch(error => {
    console.error('Unhandled error in main:', error);
    setFailed(`Unhandled error: ${error.message}`);
});