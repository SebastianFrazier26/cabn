export function walk(tree) {
	for (const branch of tree) {
		if (branch.alive) {
			while (branch.next) {
				try {
					if (branch.leaf) {
						console.log(branch.leaf);
					}
				} catch {
					return null;
				}
			}
		}
	}
	return tree;
}
