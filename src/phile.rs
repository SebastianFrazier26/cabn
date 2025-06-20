/* src/phile.rs
@SebastianFrazier 
Defines a 'file' object to capture and implement base functionality for our file management system */

pub enum PhilePriv {
        Read,
        Write,
        ReadWrite,
        Execute
}

pub enum PhileErr {
        // OS Error
        IoError(std::io::Error),
        // Unauthorized Privelege
        InvalidMode,
        // Opening Error
        Corrupted,
        // File not found
        NullTypeError
}

pub struct Phile {
        size: usize,
        content: String,
        name: String,
        privelege: PhilePriv,
        extension: String
}

impl Phile {
        // Constructor
        pub fn new(name: String, content: String, privelege: PhilePriv, ext: String) -> Self {
                Phile {
                        name: name,
                        size: content.len(),
                        content: content,
                        privelege: privelege,
                        extension: ext
                }
        }

        pub fn open<P: AsRef<std::path::Path>>(path: P, privelege: PhilePriv) 
         -> Result<Self, PhileErr>
        {
                unimplemented!()
        }

        pub fn read(&mut self, buf: &mut [u32]) 
        {
                unimplemented!()
        }

        pub fn write(&mut self, buf: &mut [u32])
        {
                unimplemented!()
        }

        pub fn encrypt(self, f: fn(Phile) -> Phile)
        {
                unimplemented!()
        }

        pub fn decrypt(self, f: fn(Phile) -> Phile)
        {
                unimplemented!()
        }

        pub fn execute(&mut self, path: String)
        {
                unimplemented!()
        }

        pub fn close(self) 
        {
                unimplemented!()
        }

}