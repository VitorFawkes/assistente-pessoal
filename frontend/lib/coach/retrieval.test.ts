import {test,expect} from "bun:test";
import {cosine} from "./retrieval";
test("semantic similarity ranks the matching direction and safely handles zero vectors",()=>{
 expect(cosine([1,0],[1,0])).toBeGreaterThan(cosine([1,0],[0,1]));
 expect(cosine([0,0],[1,0])).toBe(0);
 expect(cosine([1],[1,2])).toBe(0);
});
