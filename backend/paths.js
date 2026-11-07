const path = require('path');

const backendRoot = __dirname;
const projectRoot = path.join(backendRoot, '..');

module.exports = {
    projectRoot,
    publicDir: path.join(projectRoot, 'frontend', 'public'),
    views: path.join(projectRoot, 'frontend', 'views'),
    uploads: path.join(projectRoot, 'storage', 'uploads'),
    embeddings: path.join(projectRoot, 'storage', 'embeddings'),
    processing: path.join(backendRoot, 'processing'),
};
