function require(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  focusToken:         require('FOCUS_NFE_TOKEN'),
  nfeResultsQueueUrl: require('NFE_RESULTS_QUEUE_URL'),
  nfeBucket:          require('NFE_BUCKET'),
  awsRegion:          process.env.AWS_REGION ?? 'us-east-1',
};
