export const modelCategories = [
 ['generators','Image generators'],['critics','Vision critics'],['features','Visual similarity'],['encoders','Text encoders'],['drafters','Assistant drafters'],['other','Supporting models'],
];
export function modelCategory(item) {
 const identity=[item.id,item.name,item.repo].filter(Boolean).join(' ').toLowerCase();
 if(/assistant|drafter/.test(identity))return 'drafters';
 if(/encoder|flux2-nf4|flux2-fp8/.test(identity))return 'encoders';
 if(/pixtral|gemma/.test(identity))return 'critics';
 if(/dino/.test(identity))return 'features';
 if(/flux/.test(identity))return 'generators';
 return 'other';
}
