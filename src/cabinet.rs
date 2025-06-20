use crate::phile::Phile;
struct Cabinet {
        pub contents: Vec<Phile>,
        pub name: String,
        pub size: u32,
}

impl Cabinet {
        // Construct from scratch
        pub fn new(name: String) -> Self {
                Cabinet {
                        contents: Vec::new(),
                        name: name,
                        size: 0
                }
        }

        
}